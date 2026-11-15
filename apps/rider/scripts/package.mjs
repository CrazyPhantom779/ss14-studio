import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const riderRoot = resolve(here, '..');
const releasesDir = resolve(riderRoot, '..', '..', 'releases');

const candidates =
  process.platform === 'win32'
    ? [
        join(riderRoot, 'gradlew.bat'),
        'gradle.bat',
        'gradle',
      ]
    : [join(riderRoot, 'gradlew'), 'gradle'];

const command = candidates.find((candidate) =>
  candidate.includes('/') || candidate.includes('\\')
    ? existsSync(candidate)
    : true,
);

if (!command) {
  console.error(
    'Gradle was not found. Install Gradle or add a Gradle wrapper to apps/rider.',
  );
  process.exit(1);
}

const child = spawn(command, ['buildPlugin', '--no-daemon'], {
  cwd: riderRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', async (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  try {
    const distributions = join(riderRoot, 'build', 'distributions');
    const zips = (await readdir(distributions)).filter((name) => name.endsWith('.zip'));
    if (zips.length === 0) {
      throw new Error(`No plugin ZIP found in ${distributions}.`);
    }
    await mkdir(releasesDir, { recursive: true });
    for (const zip of zips) {
      await copyFile(join(distributions, zip), join(releasesDir, zip));
    }
    console.log(`Copied ${zips.join(', ')} to releases/`);
  } catch (error) {
    console.error(
      `Could not copy the Rider plugin ZIP: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
});
