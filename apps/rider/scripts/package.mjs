import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const riderRoot = resolve(here, '..');

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

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
