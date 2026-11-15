import { promises as fs } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.vs',
  '.gradle',
  '.intellijPlatform',
  'node_modules',
  'bin',
  'obj',
  'Library',
  'Temp',
  'dist',
  'out',
  'build',
  'releases',
]);

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

export function isInside(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return (
    resolvedChild === resolvedParent ||
    resolvedChild.startsWith(
      resolvedParent.endsWith(sep) ? resolvedParent : `${resolvedParent}${sep}`,
    )
  );
}

export function relativeInside(parent: string, child: string): string | null {
  if (!isInside(parent, child)) return null;
  return normalizeSlashes(relative(parent, child));
}

export function rootFor(roots: string[], path: string): string | undefined {
  return roots.find((root) => isInside(root, path));
}

export function relativeToRoots(roots: string[], path: string): string {
  for (const root of roots) {
    const relativePath = relativeInside(root, path);
    if (relativePath != null) return relativePath;
  }
  return normalizeSlashes(path);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

export interface TextFile {
  text: string;
  bom: boolean;
}

export async function readTextFile(path: string): Promise<TextFile> {
  const buffer = await fs.readFile(path);
  const bom =
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf;
  return {
    text: buffer.toString('utf8', bom ? 3 : 0),
    bom,
  };
}

export async function writeTextFile(
  path: string,
  text: string,
  bom = false,
): Promise<void> {
  await fs.writeFile(path, bom ? `\ufeff${text}` : text, 'utf8');
}

export async function walkFiles(
  root: string,
  accept: (path: string) => boolean,
  options: { maxFiles?: number } = {},
): Promise<string[]> {
  const maxFiles = options.maxFiles ?? 100_000;
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0 && result.length < maxFiles) {
    const directory = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        stack.push(join(directory, entry.name));
      } else if (entry.isFile()) {
        const path = join(directory, entry.name);
        if (accept(path)) {
          result.push(path);
          if (result.length >= maxFiles) break;
        }
      }
    }
  }
  return result;
}

export function resolveFileArgument(
  roots: string[],
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^file:/i.test(trimmed)) {
    try {
      return fileURLToPath(new URL(trimmed));
    } catch {
      return undefined;
    }
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return undefined;
  }
  if (isAbsolute(trimmed)) return resolve(trimmed);
  return resolve(roots[0] ?? process.cwd(), trimmed);
}

export function baseName(path: string): string {
  return basename(path);
}

export function parentPath(path: string): string {
  return resolve(path, '..');
}
