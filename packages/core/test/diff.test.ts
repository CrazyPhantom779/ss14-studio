import { describe, expect, it } from 'vitest';
import { diffText } from '../src/index.js';

describe('text diff', () => {
  it('reports added and removed line counts with labels', () => {
    const diff = diffText({
      oldText: 'alpha\nbeta\ngamma\n',
      newText: 'alpha\nbeta changed\ngamma\ndelta\n',
      title: 'Preview',
      oldLabel: 'Current',
      newLabel: 'Updated',
    });
    expect(diff.title).toBe('Preview');
    expect(diff.oldLabel).toBe('Current');
    expect(diff.newLabel).toBe('Updated');
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);
    expect(diff.identical).toBe(false);
    expect(diff.oldText).toBe('alpha\nbeta\ngamma\n');
    expect(diff.newText).toBe('alpha\nbeta changed\ngamma\ndelta\n');
  });

  it('builds hunks with context and stable old/new line numbers', () => {
    const diff = diffText({
      oldText: 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n',
      newText: 'one\ntwo\nTHREE\nfour\nfive\nsix\nseven\neight\n',
    });
    expect(diff.hunks).toHaveLength(1);
    const hunk = diff.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.lines.map((line) => line.text)).toEqual([
      'one',
      'two',
      'three',
      'THREE',
      'four',
      'five',
      'six',
    ]);
    expect(hunk.lines.find((line) => line.text === 'three')).toMatchObject({
      kind: 'remove',
      oldLine: 3,
      newLine: null,
    });
    expect(hunk.lines.find((line) => line.text === 'THREE')).toMatchObject({
      kind: 'add',
      oldLine: null,
      newLine: 3,
    });
    expect(hunk.oldCount).toBe(6);
    expect(hunk.newCount).toBe(6);
  });

  it('splits distant changes into separate hunks', () => {
    const oldLines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
    const newLines = [...oldLines];
    newLines[2] = 'changed near top';
    newLines[26] = 'changed near bottom';
    const diff = diffText({ oldText: oldLines.join('\n'), newText: newLines.join('\n') });
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0]!.lines.some((line) => line.text === 'changed near top')).toBe(true);
    expect(diff.hunks[1]!.lines.some((line) => line.text === 'changed near bottom')).toBe(true);
  });

  it('normalizes CRLF and CR input before comparing', () => {
    const diff = diffText({ oldText: 'a\r\nb\r\n', newText: 'a\nb\n' });
    expect(diff.identical).toBe(true);
    expect(diff.hunks).toEqual([]);
  });

  it('detects merge conflict markers on either side', () => {
    expect(diffText({ oldText: 'a\n<<<<<<< HEAD\nb\n', newText: 'a\nb\n' }).conflicts).toBe(true);
    expect(diffText({ oldText: 'a\n', newText: 'a\n>>>>>>> branch\n' }).conflicts).toBe(true);
    expect(diffText({ oldText: 'a\n', newText: 'a\n' }).conflicts).toBe(false);
  });

  it('handles empty files and complete replacements', () => {
    const added = diffText({ oldText: '', newText: 'first\nsecond\n' });
    expect(added.added).toBe(2);
    expect(added.removed).toBe(0);
    expect(added.identical).toBe(false);

    const removed = diffText({ oldText: 'first\nsecond\n', newText: '' });
    expect(removed.added).toBe(0);
    expect(removed.removed).toBe(2);

    const replaced = diffText({ oldText: 'old\n', newText: 'new\n' });
    expect(replaced.hunks[0]?.lines.map((line) => line.kind)).toEqual([
      'remove',
      'add',
      'context',
    ]);
  });

  it('treats identical whitespace and trailing newlines as changes', () => {
    const diff = diffText({ oldText: 'line', newText: 'line\n' });
    expect(diff.identical).toBe(false);
    expect(diff.added).toBe(1);
  });
});
