import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { HostMessage, WebviewMessage } from '@ss14-studio/core';

export interface StudioServerOptions {
  webDir: string;
  token: string;
  version: string;
  /** Serialized into /api/bootstrap.js before the UI bundle runs. */
  getBootstrap: () => Record<string, unknown>;
  onMessage: (message: WebviewMessage) => void | Promise<void>;
  getUiState: () => unknown;
  onUiState: (state: unknown) => void | Promise<void>;
  getHealth: () => Record<string, unknown>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const MAX_BODY_BYTES = 128 * 1024 * 1024;

interface Client {
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

/**
 * A tiny loopback HTTP server. JCEF cannot load ES modules from file:// URLs
 * reliably, so the Rider host serves the shared UI over 127.0.0.1 instead.
 */
export class StudioServer {
  private readonly server;
  private readonly clients = new Set<Client>();
  private pending: string[] = [];
  private port = 0;
  private closing = false;

  constructor(private readonly options: StudioServerOptions) {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        console.error('[ss14-studio] request failed', error);
        if (!response.headersSent) {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        response.end('Internal server error');
      });
    });
    this.server.on('error', (error) => {
      console.error('[ss14-studio] server error', error);
    });
  }

  get address(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  url(path: string): string {
    const separator = path.includes('?') ? '&' : '?';
    return `${this.address}${path}${separator}token=${encodeURIComponent(this.options.token)}`;
  }

  async listen(preferredPort = 0): Promise<number> {
    await new Promise<void>((resolvePromise, reject) => {
      this.server.once('error', reject);
      this.server.listen(preferredPort, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolvePromise();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('The local Studio server did not receive a TCP port.');
    }
    this.port = address.port;
    return this.port;
  }

  broadcast(message: HostMessage): void {
    const payload = JSON.stringify(message);
    if (this.clients.size === 0) {
      this.pending.push(payload);
      if (this.pending.length > 500) this.pending.shift();
      return;
    }
    for (const client of this.clients) {
      this.writeEvent(client.response, payload);
    }
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const client of this.clients) {
      clearInterval(client.heartbeat);
      client.response.end();
    }
    this.clients.clear();
    await new Promise<void>((resolvePromise) => {
      this.server.close(() => resolvePromise());
    });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname);

    if (path === '/api/health') {
      this.json(response, 200, {
        ok: true,
        version: this.options.version,
        ...this.options.getHealth(),
      });
      return;
    }

    if (path === '/api/bootstrap.js') {
      if (!this.authorized(request, url)) {
        this.json(response, 403, { error: 'Invalid Studio token.' });
        return;
      }
      const bootstrap = {
        token: this.options.token,
        version: this.options.version,
        ...this.options.getBootstrap(),
      };
      const body = `window.__SS14_BOOTSTRAP__ = ${serializeForScript(bootstrap)};\n`;
      response.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(body);
      return;
    }

    if (path === '/api/events') {
      if (!this.authorized(request, url)) {
        this.json(response, 403, { error: 'Invalid Studio token.' });
        return;
      }
      this.openEvents(response);
      return;
    }

    if (path === '/api/message') {
      if (!this.authorized(request, url)) {
        this.json(response, 403, { error: 'Invalid Studio token.' });
        return;
      }
      if (request.method !== 'POST') {
        this.json(response, 405, { error: 'Use POST.' });
        return;
      }
      const body = await readBody(request);
      let message: WebviewMessage;
      try {
        message = JSON.parse(body) as WebviewMessage;
      } catch {
        this.json(response, 400, { error: 'Expected a JSON message.' });
        return;
      }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        this.json(response, 400, { error: 'The message has no type.' });
        return;
      }
      try {
        await this.options.onMessage(message);
        this.json(response, 200, { ok: true });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        console.error('[ss14-studio] message failed', message.type, error);
        this.json(response, 500, { ok: false, error: text });
      }
      return;
    }

    if (path === '/api/ui-state') {
      if (!this.authorized(request, url)) {
        this.json(response, 403, { error: 'Invalid Studio token.' });
        return;
      }
      if (request.method === 'GET') {
        this.json(response, 200, this.options.getUiState() ?? {});
        return;
      }
      if (request.method === 'PUT' || request.method === 'POST') {
        const body = await readBody(request);
        let state: unknown;
        try {
          state = JSON.parse(body);
        } catch {
          this.json(response, 400, { error: 'Expected JSON.' });
          return;
        }
        await this.options.onUiState(state);
        this.json(response, 200, { ok: true });
        return;
      }
      this.json(response, 405, { error: 'Use GET or PUT.' });
      return;
    }

    if (path === '/') {
      response.writeHead(302, { Location: `/rider.html${url.search}` });
      response.end();
      return;
    }

    if (path === '/rider.html') {
      await this.serveFile(response, 'rider.html');
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      this.json(response, 405, { error: 'Use GET.' });
      return;
    }

    const relative = path.replace(/^\/+/, '');
    if (!relative || relative.includes('\0')) {
      this.json(response, 404, { error: 'Not found.' });
      return;
    }
    await this.serveFile(response, relative);
  }

  private async serveFile(
    response: ServerResponse,
    relative: string,
  ): Promise<void> {
    const webDir = resolve(this.options.webDir);
    const target = resolve(webDir, normalize(relative));
    if (target !== webDir && !target.startsWith(`${webDir}${sep}`)) {
      this.json(response, 404, { error: 'Not found.' });
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(target);
    } catch {
      if (relative === 'rider.html') {
        this.html(
          response,
          500,
          `<!doctype html><html><body style="font:14px sans-serif;background:#0a1017;color:#dbeafe;padding:32px">
          <h1>SS14 Studio</h1><p>The shared web UI was not built.</p>
          <p>Run <code>npm run build:rider</code> before packaging the Rider plugin.</p></body></html>`,
        );
        return;
      }
      this.json(response, 404, { error: 'Not found.' });
      return;
    }
    const extension = extname(target).toLowerCase();
    const cache =
      extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable';
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(bytes);
  }

  private openEvents(response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(': connected\n\n');
    const heartbeat = setInterval(() => {
      try {
        response.write(': ping\n\n');
      } catch {
        // The close handler removes the client.
      }
    }, 15_000);
    const client: Client = { response, heartbeat };
    this.clients.add(client);

    if (this.pending.length > 0) {
      const queued = this.pending;
      this.pending = [];
      for (const payload of queued) this.writeEvent(response, payload);
    }

    const close = () => {
      clearInterval(heartbeat);
      this.clients.delete(client);
    };
    response.on('close', close);
    response.on('error', close);
  }

  private writeEvent(response: ServerResponse, payload: string): void {
    try {
      response.write(`data: ${payload}\n\n`);
    } catch {
      // A dead client is cleaned up by the response close handler.
    }
  }

  private authorized(request: IncomingMessage, url: URL): boolean {
    const token = url.searchParams.get('token');
    if (token === this.options.token) return true;
    const header = request.headers['x-ss14-token'];
    return header === this.options.token;
  }

  private json(
    response: ServerResponse,
    status: number,
    value: unknown,
  ): void {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(value));
  }

  private html(
    response: ServerResponse,
    status: number,
    value: string,
  ): void {
    response.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(value);
  }
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('The Studio request is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
