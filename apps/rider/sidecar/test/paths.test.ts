import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  baseName,
  ensureDirectory,
  isDirectory,
  isInside,
  normalizeSlashes,
  parentPath,
  pathExists,
  readTextFile,
  relativeInside,
  relativeToRoots,
  resolveFileArgument,
  rootFor,
  walkFiles,
  writeTextFile,
} from '../src/paths.js';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'ss14-paths-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('path helpers', () => {
  it('normalizes slashes and checks containment', () => {
    expect(normalizeSlashes('Resources\\Prototypes\\a.yml')).toBe('Resources/Prototypes/a.yml');
    expect(isInside(root, join(root, 'child'))).toBe(true);
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, join(root, '..', 'outside'))).toBe(false);
    expect(relativeInside(root, join(root, 'a', 'b'))).toBe('a/b');
    expect(relativeInside(root, join(root, '..', 'outside'))).toBeNull();
    expect(rootFor([root, join(root, 'other')], join(root, 'a'))).toBe(root);
    expect(rootFor([join(root, 'other')], join(root, 'a'))).toBeUndefined();
    expect(relativeToRoots([root], join(root, 'a', 'b'))).toBe('a/b');
    expect(relativeToRoots([], join(root, 'a'))).toBe(normalizeSlashes(join(root, 'a')));
    expect(baseName(join(root, 'a.yml'))).toBe('a.yml');
    expect(parentPath(join(root, 'a', 'b.yml'))).toBe(join(root, 'a'));
  });

  it('creates directories and detects files versus directories', async () => {
    const directory = join(root, 'nested', 'deep');
    expect(await pathExists(directory)).toBe(false);
    expect(await isDirectory(directory)).toBe(false);
    await ensureDirectory(directory);
    expect(await pathExists(directory)).toBe(true);
    expect(await isDirectory(directory)).toBe(true);
    const file = join(directory, 'file.txt');
    await fs.writeFile(file, 'x');
    expect(await isDirectory(file)).toBe(false);
  });

  it('reads and writes UTF-8 text while preserving BOM intent', async () => {
    const plain = join(root, 'plain.txt');
    await writeTextFile(plain, 'hello');
    expect(await readTextFile(plain)).toEqual({ text: 'hello', bom: false });
    await writeTextFile(plain, 'hello', true);
    expect(await readTextFile(plain)).toEqual({ text: 'hello', bom: true });
    await fs.writeFile(plain, '\ufeffwith bom');
    expect((await readTextFile(plain)).text).toBe('with bom');
  });

  it('walks files while skipping ignored directories and enforcing filters', async () => {
    await fs.mkdir(join(root, 'Resources'), { recursive: true });
    await fs.mkdir(join(root, 'node_modules'), { recursive: true });
    await fs.mkdir(join(root, 'build'), { recursive: true });
    await fs.writeFile(join(root, 'Resources', 'a.yml'), 'a');
    await fs.writeFile(join(root, 'Resources', 'b.yaml'), 'b');
    await fs.writeFile(join(root, 'Resources', 'c.txt'), 'c');
    await fs.writeFile(join(root, 'node_modules', 'hidden.yml'), 'hidden');
    await fs.writeFile(join(root, 'build', 'hidden.yml'), 'hidden');

    const files = await walkFiles(root, (path) => /\.ya?ml$/i.test(path));
    expect(files.map((path) => normalizeSlashes(path)).sort()).toEqual([
      `${normalizeSlashes(root)}/Resources/a.yml`,
      `${normalizeSlashes(root)}/Resources/b.yaml`,
    ]);

    const limited = await walkFiles(root, () => true, { maxFiles: 1 });
    expect(limited).toHaveLength(1);
    expect(await walkFiles(join(root, 'missing'), () => true)).toEqual([]);
  });

  it('resolves absolute, relative, file URL and invalid path arguments', () => {
    const absolute = join(root, 'Resources', 'a.yml');
    expect(resolveFileArgument([root], absolute)).toBe(absolute);
    expect(resolveFileArgument([root], 'Resources/a.yml')).toBe(absolute);
    expect(resolveFileArgument([root], pathToFileURL(absolute).href)).toBe(absolute);
    expect(resolveFileArgument([root], '   ')).toBeUndefined();
    expect(resolveFileArgument([root], 'https://example.com/a.yml')).toBeUndefined();
    expect(resolveFileArgument([], 'relative.yml')).toBe(join(process.cwd(), 'relative.yml'));
  });
});
