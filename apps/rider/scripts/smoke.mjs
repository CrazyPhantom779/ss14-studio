import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const riderRoot = resolve(here, '..');
const fixtureProject = resolve(riderRoot, 'fixtures', 'sample-project');
const project = resolve(process.argv[2] ?? fixtureProject);
const stateDir = await mkdtemp(join(tmpdir(), 'ss14-studio-smoke-'));
const sidecarPath = resolve(riderRoot, 'sidecar', 'dist', 'sidecar.mjs');
const webDir = resolve(riderRoot, 'web');

const child = spawn(
  process.execPath,
  [
    sidecarPath,
    '--project',
    project,
    '--root',
    project,
    '--web',
    webDir,
    '--state',
    stateDir,
    '--theme',
    'dark',
  ],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);

const messages = [];
const waiters = [];
let ready = null;

const pushMessage = (message) => {
  messages.push(message);
  for (const waiter of [...waiters]) {
    if (waiter.predicate(message)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }
};

const waitFor = (predicate, timeoutMs = 120_000, label = 'message') =>
  new Promise((resolvePromise, reject) => {
    const existing = messages.find(predicate);
    if (existing) {
      resolvePromise(existing);
      return;
    }
    const waiter = { predicate, resolve: resolvePromise };
    waiter.timer = setTimeout(() => {
      waiters.splice(waiters.indexOf(waiter), 1);
      reject(new Error(`Timed out waiting for ${label}.`));
    }, timeoutMs);
    waiters.push(waiter);
  });

const readyLine = new Promise((resolvePromise, reject) => {
  const reader = createInterface({ input: child.stdout });
  const timer = setTimeout(() => reject(new Error('Sidecar did not report ready.')), 30_000);
  reader.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.log(`sidecar: ${line}`);
      return;
    }
    if (message.type === 'ready') {
      clearTimeout(timer);
      ready = message;
      resolvePromise(message);
    } else {
      pushMessage(message);
    }
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`Sidecar exited before ready (${code}).`));
  });
});

const token = new URL((await readyLine).url).searchParams.get('token');
const api = (path) => `${ready.url.split('/rider.html')[0]}${path}?token=${encodeURIComponent(token)}`;

const post = async (message) => {
  const response = await fetch(api('/api/message'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`Message ${message.type} failed: ${response.status}`);
};

const health = await fetch(api('/api/health')).then((response) => response.json());
if (!health.ok) throw new Error('Health check failed.');
console.log(`health: ${health.version}, project ${health.project}`);

const bootstrapResponse = await fetch(api('/api/bootstrap.js'));
const bootstrap = await bootstrapResponse.text();
if (!bootstrap.includes('__SS14_BOOTSTRAP__')) {
  throw new Error('Bootstrap script was not generated.');
}
console.log('bootstrap: ok');

const events = await fetch(api('/api/events'));
if (!events.ok || !events.body) throw new Error('SSE stream did not open.');
const reader = events.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pump = (async () => {
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          pushMessage(JSON.parse(line.slice(6)));
        } catch {
          // Ignore keep-alive comments and malformed frames.
        }
      }
    }
  }
})();
console.log('sse: connected');

await post({ type: 'ready' });
const index = await waitFor(
  (message) => message.type === 'index' && message.payload.project.totalGraphs > 0,
  180_000,
  'a non-empty index',
);
const prototypes = await waitFor(
  (message) => message.type === 'prototypes' && message.payload.total > 0,
  180_000,
  'non-empty prototypes',
);
const totalGraphs = index.payload.project.totalGraphs;
const totalPrototypes = prototypes.payload.total;
if (totalGraphs === 0) throw new Error('No construction graphs were indexed.');
if (totalPrototypes === 0) throw new Error('No prototypes were indexed.');
console.log(`index: ${totalGraphs} graphs, ${totalPrototypes} prototypes`);

const summary = index.payload.summaries[0];
await post({ type: 'openGraph', key: summary.key });
const graph = await waitFor(
  (message) => message.type === 'graph' && message.graph?.key === summary.key,
  30_000,
  'graph',
);
console.log(`graph: ${graph.graph.id}, ${graph.graph.nodes.length} nodes`);

const prototypeSummary = prototypes.payload.summaries[0];
await post({
  type: 'openPrototype',
  id: prototypeSummary.id,
  kind: prototypeSummary.kind,
});
const prototype = await waitFor(
  (message) =>
    message.type === 'prototype' && message.view?.summary?.id === prototypeSummary.id,
  30_000,
  'prototype',
);
console.log(
  `prototype: ${prototype.view.summary.id}, ${prototype.view.resolved.components.length} components`,
);

await post({ type: 'openAbout' });
await waitFor(
  (message) => message.type === 'view' && message.view?.kind === 'about',
  10_000,
  'about view',
);
console.log('about: ok');

await post({ type: 'openDashboard' });
await waitFor(
  (message) => message.type === 'view' && message.view?.kind === 'dashboard',
  10_000,
  'dashboard view',
);
console.log('dashboard: ok');

child.stdin.write(`${JSON.stringify({ command: 'shutdown' })}\n`);
child.stdin.end();
await new Promise((resolvePromise) => {
  const timer = setTimeout(() => {
    child.kill();
    resolvePromise();
  }, 10_000);
  child.on('exit', () => {
    clearTimeout(timer);
    resolvePromise();
  });
});
reader.cancel().catch(() => undefined);
await pump.catch(() => undefined);
await rm(stateDir, { recursive: true, force: true });
console.log('smoke test passed');
