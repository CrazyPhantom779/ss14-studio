import type { DiffHunk, DiffLine, DiffPayload } from './model.js';

interface RawDiff {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * Line diff using a trimmed LCS table. Very large files fall back to a single
 * replacement block, which keeps the UI responsive while still being useful.
 */
function rawDiff(oldText: string, newText: string): RawDiff[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const middleA = a.slice(prefix, a.length - suffix);
  const middleB = b.slice(prefix, b.length - suffix);
  const output: RawDiff[] = [];
  for (let index = 0; index < prefix; index++) {
    output.push({
      kind: 'context',
      text: a[index]!,
      oldLine: index + 1,
      newLine: index + 1,
    });
  }

  if (middleA.length * middleB.length > 4_000_000) {
    middleA.forEach((text, index) => {
      output.push({ kind: 'remove', text, oldLine: prefix + index + 1, newLine: null });
    });
    middleB.forEach((text, index) => {
      output.push({ kind: 'add', text, oldLine: null, newLine: prefix + index + 1 });
    });
  } else {
    const rows = middleA.length + 1;
    const columns = middleB.length + 1;
    const table = new Uint32Array(rows * columns);
    for (let i = middleA.length - 1; i >= 0; i--) {
      for (let j = middleB.length - 1; j >= 0; j--) {
        table[i * columns + j] =
          middleA[i] === middleB[j]
            ? table[(i + 1) * columns + j + 1]! + 1
            : Math.max(table[(i + 1) * columns + j]!, table[i * columns + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < middleA.length && j < middleB.length) {
      if (middleA[i] === middleB[j]) {
        output.push({
          kind: 'context',
          text: middleA[i]!,
          oldLine: prefix + i + 1,
          newLine: prefix + j + 1,
        });
        i++;
        j++;
      } else if (table[(i + 1) * columns + j]! >= table[i * columns + j + 1]!) {
        output.push({
          kind: 'remove',
          text: middleA[i]!,
          oldLine: prefix + i + 1,
          newLine: null,
        });
        i++;
      } else {
        output.push({
          kind: 'add',
          text: middleB[j]!,
          oldLine: null,
          newLine: prefix + j + 1,
        });
        j++;
      }
    }
    while (i < middleA.length) {
      output.push({
        kind: 'remove',
        text: middleA[i]!,
        oldLine: prefix + i + 1,
        newLine: null,
      });
      i++;
    }
    while (j < middleB.length) {
      output.push({
        kind: 'add',
        text: middleB[j]!,
        oldLine: null,
        newLine: prefix + j + 1,
      });
      j++;
    }
  }

  for (let index = 0; index < suffix; index++) {
    const oldIndex = a.length - suffix + index;
    const newIndex = b.length - suffix + index;
    output.push({
      kind: 'context',
      text: a[oldIndex]!,
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
    });
  }
  return output;
}

function buildHunks(lines: RawDiff[], context = 3): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.kind === 'context' ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return [];

  const ranges: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    const first = slice[0]!;
    const lastLine = slice[slice.length - 1]!;
    const oldStart = first.oldLine ?? lines.slice(0, start).filter((line) => line.oldLine != null).length + 1;
    const newStart = first.newLine ?? lines.slice(0, start).filter((line) => line.newLine != null).length + 1;
    return {
      oldStart,
      oldCount:
        slice.filter((line) => line.oldLine != null).length ||
        (lastLine.oldLine != null ? 0 : 0),
      newStart,
      newCount: slice.filter((line) => line.newLine != null).length,
      lines: slice.map<DiffLine>((line) => ({
        kind: line.kind,
        text: line.text,
        oldLine: line.oldLine,
        newLine: line.newLine,
      })),
    };
  });
}

export function diffText(input: {
  oldText: string;
  newText: string;
  title?: string;
  oldLabel?: string;
  newLabel?: string;
}): DiffPayload {
  const lines = rawDiff(input.oldText, input.newText);
  const added = lines.filter((line) => line.kind === 'add').length;
  const removed = lines.filter((line) => line.kind === 'remove').length;
  return {
    title: input.title ?? 'Changes',
    oldLabel: input.oldLabel ?? 'Before',
    newLabel: input.newLabel ?? 'After',
    oldText: input.oldText,
    newText: input.newText,
    hunks: buildHunks(lines),
    added,
    removed,
    identical: added === 0 && removed === 0,
    conflicts: /^(<{7}|={7}|>{7})/m.test(input.oldText) || /^(<{7}|={7}|>{7})/m.test(input.newText),
  };
}
