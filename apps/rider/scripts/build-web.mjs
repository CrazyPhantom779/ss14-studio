import { promises as fs } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const riderRoot = resolve(here, '..');
const repoRoot = resolve(riderRoot, '..', '..');
const uiDist = resolve(repoRoot, 'apps', 'vscode', 'media', 'webview');
const webDir = resolve(riderRoot, 'web');
const sidecarBundle = resolve(riderRoot, 'sidecar', 'dist', 'sidecar.mjs');

const exists = async (path) => {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
};

const copyDirectory = async (from, to) => {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(source, target);
    } else if (entry.isFile()) {
      await fs.copyFile(source, target);
    }
  }
};

const listFiles = async (directory, prefix) => {
  const result = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(path, `${prefix}/${entry.name}`)));
    } else if (entry.isFile()) {
      result.push(`${prefix}/${entry.name}`);
    }
  }
  return result;
};

if (!(await exists(join(uiDist, 'assets', 'studio.js')))) {
  console.error(
    'The shared UI is not built. Run "npm run build -w @ss14-studio/ui" first.',
  );
  process.exit(1);
}

await fs.mkdir(webDir, { recursive: true });
await fs.rm(join(webDir, 'assets'), { recursive: true, force: true });
await copyDirectory(join(uiDist, 'assets'), join(webDir, 'assets'));

const riderHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>SS14 Studio</title>
    <link rel="stylesheet" href="/assets/style.css" />
    <script src="/api/bootstrap.js"></script>
    <script src="/rider-bridge.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/studio.js"></script>
  </body>
</html>
`;
await fs.writeFile(join(webDir, 'rider.html'), riderHtml, 'utf8');

if (!(await exists(sidecarBundle))) {
  console.error(
    'The Rider sidecar is not built. Run "npm run build -w @ss14-studio/rider-sidecar" first.',
  );
  process.exit(1);
}

const webFiles = [
  ...(await listFiles(webDir, 'web')),
  'sidecar/sidecar.mjs',
].sort();
await fs.writeFile(
  resolve(riderRoot, 'web-files.txt'),
  `${webFiles.join('\n')}\n`,
  'utf8',
);

console.log(
  `Staged ${webFiles.length} Rider resources (${relative(repoRoot, webDir)}).`,
);
