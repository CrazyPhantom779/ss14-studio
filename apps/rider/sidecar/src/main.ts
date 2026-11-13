import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { basename, resolve } from 'node:path';
import type { HostMessage, WebviewMessage } from '@ss14-studio/core';
import { sanitizeConfig, sanitizeSettings } from './config.js';
import { IdeBridge } from './ide.js';
import { StateStore } from './state.js';
import { StudioSession } from './studio.js';
import { StudioServer } from './server.js';

type ThemeKind = 'dark' | 'light' | 'high-contrast';

interface Options {
  project: string;
  roots: string[];
  webDir: string;
  stateDir: string;
  port: number;
  theme: ThemeKind;
  version: string;
}

const VERSION = '0.2.0';

function log(message: string, error?: unknown): void {
  const suffix = error instanceof Error ? `: ${error.message}` : '';
  process.stderr.write(`[ss14-studio] ${message}${suffix}\n`);
  if (error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
}

function parseArgs(argv: string[]): Options {
  let project = process.cwd();
  const roots: string[] = [];
  let webDir = '';
  let stateDir = '';
  let port = 0;
  let theme: ThemeKind = 'dark';
  let version = VERSION;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const next = () => argv[++index];
    switch (argument) {
      case '--project':
        project = next() ?? project;
        break;
      case '--root': {
        const value = next();
        if (value) roots.push(...value.split(',').map((part) => part.trim()).filter(Boolean));
        break;
      }
      case '--web':
        webDir = next() ?? '';
        break;
      case '--state':
        stateDir = next() ?? '';
        break;
      case '--port':
        port = Number(next() ?? 0) || 0;
        break;
      case '--theme': {
        const value = next();
        if (value === 'light' || value === 'high-contrast' || value === 'dark') {
          theme = value;
        }
        break;
      }
      case '--version': {
        const value = next();
        if (value) version = value;
        break;
      }
      default:
        break;
    }
  }

  const absoluteProject = resolve(project);
  return {
    project: absoluteProject,
    roots: roots.length > 0 ? roots.map((root) => resolve(root)) : [absoluteProject],
    webDir: webDir ? resolve(webDir) : resolve(process.cwd(), 'web'),
    stateDir: stateDir ? resolve(stateDir) : resolve(absoluteProject, '.idea', 'ss14-studio'),
    port,
    theme,
    version,
  };
}

function write(message: unknown): void {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch (error) {
    log('could not write to stdout', error);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const token = randomBytes(24).toString('hex');
  const store = new StateStore(options.stateDir, options.project);
  await store.load();

  const ide = new IdeBridge(write);
  let theme: ThemeKind = options.theme;
  let session: StudioSession | undefined;
  let shuttingDown = false;

  const server = new StudioServer({
    webDir: options.webDir,
    token,
    version: options.version,
    getBootstrap: () => ({
      theme,
      readOnly: store.readOnly,
      config: store.settings.config,
      uiState: store.uiState,
      project: {
        name: basename(options.project),
        path: options.project,
        roots: options.roots,
      },
      platform: 'rider',
      version: options.version,
    }),
    onMessage: async (message: WebviewMessage) => {
      if (!session) {
        throw new Error('SS14 Studio is still starting.');
      }
      await session.handleMessage(message);
    },
    getUiState: () => store.uiState,
    onUiState: (state) => store.saveUiState(state),
    getHealth: () => ({
      project: options.project,
      roots: options.roots,
      readOnly: store.readOnly,
      clients: 0,
    }),
  });

  session = new StudioSession(
    options.roots,
    store,
    ide,
    (message: HostMessage) => server.broadcast(message),
    (status) => write({ type: 'status', status }),
  );
  session.setTheme(theme);

  const port = await server.listen(options.port);
  write({
    type: 'ready',
    version: options.version,
    port,
    url: server.url('/rider.html'),
    project: options.project,
    roots: options.roots,
    stateDir: options.stateDir,
    readOnly: store.readOnly,
  });

  await session.start();

  const shutdown = async (code = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('shutting down');
    try {
      session?.dispose();
      await server.close();
    } catch (error) {
      log('shutdown failed', error);
    }
    process.exit(code);
  };

  const handleCommand = async (message: Record<string, unknown>): Promise<void> => {
    const command = typeof message.command === 'string' ? message.command : '';
    if (ide.handleResponse(message)) return;

    switch (command) {
      case 'ping':
        write({ type: 'pong', time: Date.now() });
        break;
      case 'refresh':
        await session!.index.refresh();
        server.broadcast({ type: 'index', payload: session!.index.getPayload() });
        server.broadcast({
          type: 'prototypes',
          payload: session!.index.getPrototypePayload(),
        });
        break;
      case 'openDashboard':
        await session!.openDashboard();
        break;
      case 'open': {
        const path = typeof message.path === 'string' ? message.path : '';
        const line = typeof message.line === 'number' ? message.line : undefined;
        if (path) await session!.openForFile(path, line, undefined, true);
        break;
      }
      case 'openPrototype': {
        const id = typeof message.id === 'string' ? message.id : '';
        const kind = typeof message.kind === 'string' ? message.kind : undefined;
        if (id) await session!.handleMessage({ type: 'openPrototype', id, kind });
        break;
      }
      case 'openRsi': {
        const path = typeof message.path === 'string' ? message.path : '';
        if (path) await session!.handleMessage({ type: 'openRsi', path });
        break;
      }
      case 'openXaml': {
        const path = typeof message.path === 'string' ? message.path : '';
        if (path) await session!.handleMessage({ type: 'openXaml', path });
        break;
      }
      case 'openPath': {
        const path = typeof message.path === 'string' ? message.path : '';
        const line = typeof message.line === 'number' ? message.line : undefined;
        if (path) await session!.openPath(path, line);
        break;
      }
      case 'setTheme': {
        const value = message.theme;
        if (value === 'dark' || value === 'light' || value === 'high-contrast') {
          theme = value;
          session!.setTheme(value);
        }
        break;
      }
      case 'setConfig': {
        const incoming = message.config;
        store.settings.config = sanitizeConfig({
          ...store.settings.config,
          ...(incoming && typeof incoming === 'object' ? incoming : {}),
        });
        await store.saveSettings();
        server.broadcast({ type: 'settings', config: store.settings.config });
        break;
      }
      case 'setSettings': {
        store.settings = sanitizeSettings({
          ...store.settings,
          ...(message.settings && typeof message.settings === 'object'
            ? message.settings
            : {}),
        });
        await store.saveSettings();
        server.broadcast({ type: 'settings', config: store.settings.config });
        break;
      }
      case 'setPreferences': {
        const incoming =
          message.settings && typeof message.settings === 'object'
            ? (message.settings as Record<string, unknown>)
            : {};
        if (typeof incoming.followEditor === 'boolean') {
          store.settings.followEditor = incoming.followEditor;
        }
        if (typeof incoming.autoRefresh === 'boolean') {
          store.settings.autoRefresh = incoming.autoRefresh;
        }
        await store.saveSettings();
        break;
      }
      case 'getConfig':
        write({
          type: 'config',
          config: store.settings.config,
          settings: {
            followEditor: store.settings.followEditor,
            autoRefresh: store.settings.autoRefresh,
          },
          readOnly: store.readOnly,
        });
        break;
      case 'filesChanged': {
        const paths = Array.isArray(message.paths)
          ? message.paths.filter((path): path is string => typeof path === 'string')
          : [];
        session!.handleExternalChanges(paths);
        break;
      }
      case 'saveUiState': {
        await store.saveUiState(message.state);
        break;
      }
      case 'shutdown':
        await shutdown();
        break;
      default:
        log(`unknown command "${command}"`);
        break;
    }
  };

  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  input.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      log('ignoring invalid JSON on stdin');
      return;
    }
    queue = queue
      .then(() => handleCommand(message))
      .catch((error) => {
        log('command failed', error);
        const text = error instanceof Error ? error.message : String(error);
        ide.notify('error', text);
      });
  });
  input.on('close', () => {
    void queue.finally(() => shutdown());
  });

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.on('uncaughtException', (error) => {
    log('uncaught exception', error);
    ide.notify('error', `SS14 Studio sidecar crashed: ${error.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    log('unhandled rejection', reason);
  });
}

main().catch((error) => {
  log('fatal error', error);
  process.exit(1);
});
