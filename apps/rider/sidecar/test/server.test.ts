import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebviewMessage } from '@ss14-studio/core';
import { StudioServer } from '../src/server.js';

let root = '';
let webDir = '';
let server: StudioServer | undefined;
let messages: WebviewMessage[] = [];
let uiState: unknown = { activeView: 'dashboard' };
let failMessages = false;
let uiStateWrites: unknown[] = [];

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'ss14-server-'));
  webDir = join(root, 'web');
  await fs.mkdir(join(webDir, 'assets'), { recursive: true });
  await fs.writeFile(join(webDir, 'rider.html'), '<!doctype html><html><body>studio</body></html>');
  await fs.writeFile(join(webDir, 'assets', 'studio.js'), 'console.log("studio");');
  await fs.writeFile(join(webDir, 'assets', 'style.css'), 'body { color: white; }');
  await fs.writeFile(join(root, 'secret.txt'), 'outside the web root');
  messages = [];
  uiState = { activeView: 'dashboard' };
  failMessages = false;
  uiStateWrites = [];
  server = new StudioServer({
    webDir,
    token: 'test-token',
    version: '9.9.9',
    getBootstrap: () => ({
      theme: 'dark',
      payload: '</script><script>alert(1)</script>',
    }),
    onMessage: (message) => {
      messages.push(message);
      if (failMessages) throw new Error('handler failed');
    },
    getUiState: () => uiState,
    onUiState: (state) => {
      uiState = state;
      uiStateWrites.push(state);
    },
    getHealth: () => ({ project: '/project', roots: ['/project'], readOnly: false, clients: 0 }),
  });
  await server.listen(0);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await fs.rm(root, { recursive: true, force: true });
});

function api(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${server!.address}${path}${separator}token=test-token`;
}

async function json(path: string, init?: RequestInit) {
  const response = await fetch(api(path), init);
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe('Rider Studio server', () => {
  it('serves health without a token', async () => {
    const response = await fetch(`${server!.address}/api/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      version: '9.9.9',
      project: '/project',
      readOnly: false,
    });
  });

  it('requires the token for the bootstrap and escapes script content', async () => {
    expect((await fetch(`${server!.address}/api/bootstrap.js`)).status).toBe(403);
    const response = await fetch(api('/api/bootstrap.js'));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('window.__SS14_BOOTSTRAP__');
    expect(body).toContain('test-token');
    expect(body).toContain('\\u003c/script>');
    expect(body).not.toContain('</script><script>alert');
  });

  it('redirects the root and serves the UI with MIME types', async () => {
    const redirect = await fetch(`${server!.address}/`, { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/rider.html');

    const html = await fetch(`${server!.address}/rider.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(html.headers.get('cache-control')).toBe('no-store');

    const script = await fetch(`${server!.address}/assets/studio.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(script.headers.get('cache-control')).toContain('immutable');

    const css = await fetch(`${server!.address}/assets/style.css`);
    expect(css.headers.get('content-type')).toContain('text/css');

    expect((await fetch(`${server!.address}/missing.js`)).status).toBe(404);
    expect((await fetch(`${server!.address}/..%2fsecret.txt`)).status).toBe(404);
  });

  it('accepts validated webview messages only with a token', async () => {
    const unauthorized = await fetch(`${server!.address}/api/message`, {
      method: 'POST',
      body: JSON.stringify({ type: 'ready' }),
    });
    expect(unauthorized.status).toBe(403);

    const invalid = await json('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    expect(invalid.response.status).toBe(400);

    const untyped = await json('/api/message', {
      method: 'POST',
      body: JSON.stringify({ payload: true }),
    });
    expect(untyped.response.status).toBe(400);

    const accepted = await json('/api/message', {
      method: 'POST',
      body: JSON.stringify({ type: 'openGraph', key: 'graph-key' }),
    });
    expect(accepted.response.status).toBe(200);
    expect(accepted.body).toEqual({ ok: true });
    expect(messages).toEqual([{ type: 'openGraph', key: 'graph-key' }]);

    const method = await json('/api/message');
    expect(method.response.status).toBe(405);

    failMessages = true;
    const failed = await json('/api/message', {
      method: 'POST',
      body: JSON.stringify({ type: 'ready' }),
    });
    expect(failed.response.status).toBe(500);
    expect(failed.body.ok).toBe(false);
    expect(failed.body.error).toContain('handler failed');
  });

  it('reads and writes UI state', async () => {
    const initial = await json('/api/ui-state');
    expect(initial.response.status).toBe(200);
    expect(initial.body).toEqual({ activeView: 'dashboard' });

    const update = await json('/api/ui-state', {
      method: 'PUT',
      body: JSON.stringify({ activeView: 'graph', key: 'x' }),
    });
    expect(update.response.status).toBe(200);
    expect(update.body).toEqual({ ok: true });
    expect(uiStateWrites).toEqual([{ activeView: 'graph', key: 'x' }]);
    expect(uiState).toEqual({ activeView: 'graph', key: 'x' });

    const invalid = await json('/api/ui-state', { method: 'PUT', body: '{bad' });
    expect(invalid.response.status).toBe(400);
    const method = await json('/api/ui-state', { method: 'DELETE' });
    expect(method.response.status).toBe(405);
  });

  it('streams queued and live SSE events', async () => {
    server!.broadcast({ type: 'toast', level: 'info', message: 'queued' });
    const controller = new AbortController();
    const response = await fetch(api('/api/events'), { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const readUntil = async (needle: string): Promise<string> => {
      const deadline = Date.now() + 5_000;
      while (!buffer.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${needle}`);
        const { value, done } = await reader.read();
        if (done) throw new Error('SSE stream closed early');
        buffer += decoder.decode(value, { stream: true });
      }
      return buffer;
    };

    await readUntil('data: ');
    expect(buffer).toContain('queued');
    server!.broadcast({ type: 'toast', level: 'success', message: 'live' });
    await readUntil('live');
    expect(buffer).toContain('"type":"toast"');

    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it('serves a helpful page when the UI was not built', async () => {
    await server!.close();
    server = undefined;
    await fs.rm(webDir, { recursive: true, force: true });
    server = new StudioServer({
      webDir,
      token: 'test-token',
      version: '9.9.9',
      getBootstrap: () => ({}),
      onMessage: () => undefined,
      getUiState: () => ({}),
      onUiState: () => undefined,
      getHealth: () => ({}),
    });
    await server.listen(0);
    const response = await fetch(`${server.address}/rider.html`);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Run <code>npm run build:rider</code>');
  });
});
