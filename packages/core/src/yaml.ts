import {
  isMap,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  type YAMLMap,
} from 'yaml';
import type { SourceSpan } from './model.js';

export function tagType(tag: string | null | undefined): string | null {
  if (!tag) return null;
  if (tag.startsWith('!type:')) return tag.slice('!type:'.length);
  if (tag.startsWith('!<') && tag.endsWith('>')) {
    const inner = tag.slice(2, -1);
    const slash = inner.lastIndexOf(':');
    return slash >= 0 ? inner.slice(slash + 1) : inner;
  }
  if (tag.startsWith('!')) return tag.slice(1);
  return tag;
}

export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(public readonly source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  /** 1-based line number for a byte offset. */
  lineAt(offset: number): number {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid]! <= clamped) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }

  lineStart(line: number): number {
    return this.starts[Math.max(0, Math.min(line - 1, this.starts.length - 1))] ?? 0;
  }

  /** End of the line content, excluding CR/LF. */
  lineContentEnd(line: number): number {
    const next = this.starts[line];
    if (next == null) return this.source.length;
    let end = next - 1;
    if (end > 0 && this.source.charCodeAt(end - 1) === 13) end--;
    return end;
  }

  /** End of the line including its newline character. */
  lineEndWithNewline(line: number): number {
    return this.starts[line] ?? this.source.length;
  }

  lineText(line: number): string {
    return this.source.slice(this.lineStart(line), this.lineContentEnd(line));
  }

  get lineCount(): number {
    return this.starts.length;
  }
}

export function spanOf(node: Node | null | undefined, lines: LineIndex): SourceSpan | null {
  const range = node?.range;
  if (!range) return null;
  const start = range[0];
  const end = range[1] ?? range[0];
  const endAnchor = end > start ? end - 1 : start;
  return {
    start,
    end,
    line: lines.lineAt(start),
    endLine: lines.lineAt(endAnchor),
  };
}

export function rawOf(node: Node | null | undefined, source: string): string {
  const range = node?.range;
  if (!range) return '';
  return source.slice(range[0], range[1] ?? range[0]).trimEnd();
}

export function getPair(
  map: YAMLMap<unknown, unknown>,
  key: string,
): Pair<unknown, unknown> | undefined {
  return map.items.find((pair) => isScalar(pair.key) && pair.key.value === key);
}

export function getNode(map: YAMLMap<unknown, unknown>, key: string): Node | null {
  const pair = getPair(map, key);
  return (pair?.value as Node | undefined) ?? null;
}

export function stringValue(node: Node | null | undefined): string | null {
  if (!node || !isScalar(node)) return null;
  const value = node.value;
  if (value == null) return null;
  return String(value);
}

export function numberValue(node: Node | null | undefined): number | null {
  if (!node || !isScalar(node)) return null;
  const value = node.value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function booleanValue(node: Node | null | undefined): boolean {
  if (!node || !isScalar(node)) return false;
  return node.value === true || node.value === 'true';
}

export function sequenceItems(node: Node | null | undefined): Node[] {
  return node && isSeq(node) ? (node.items as Node[]) : [];
}

export function mappingFields(
  node: Node | null | undefined,
): Record<string, unknown> {
  if (!node || !isMap(node)) return {};
  const out: Record<string, unknown> = {};
  for (const pair of node.items) {
    if (!isScalar(pair.key)) continue;
    out[String(pair.key.value)] = toPlain(pair.value as Node, new WeakSet());
  }
  return out;
}

export function toPlain(
  node: Node | null | undefined,
  seen = new WeakSet<object>(),
): unknown {
  if (!node) return null;

  if (isScalar(node)) {
    const type = tagType(node.tag);
    if (type) {
      return { $type: type, value: node.value ?? null };
    }
    return node.value ?? null;
  }

  if (isSeq(node)) {
    if (seen.has(node)) return '[circular]';
    seen.add(node);
    const items = (node.items as Node[]).map((item) => toPlain(item, seen));
    seen.delete(node);
    const type = tagType(node.tag);
    if (type) return { $type: type, items };
    return items;
  }

  if (isMap(node)) {
    if (seen.has(node)) return '[circular]';
    seen.add(node);
    const out: Record<string, unknown> = {};
    for (const pair of node.items) {
      if (!isScalar(pair.key)) continue;
      out[String(pair.key.value)] = toPlain(pair.value as Node, seen);
    }
    seen.delete(node);
    const type = tagType(node.tag);
    if (type) out.$type = type;
    return out;
  }

  return null;
}

export function scalarFieldSpans(
  map: YAMLMap<unknown, unknown>,
  lines: LineIndex,
): Record<string, SourceSpan> {
  const out: Record<string, SourceSpan> = {};
  for (const pair of map.items) {
    if (!isScalar(pair.key)) continue;
    const span = spanOf(pair.value as Node, lines);
    if (span) out[String(pair.key.value)] = span;
  }
  return out;
}

/** YAML-safe plain scalar. Leaves simple IDs unquoted. */
export function formatScalar(value: string | number | boolean): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === '') return "''";
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return JSON.stringify(value);
  if (/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(value)) return value;
  return JSON.stringify(value);
}

export function detectEol(source: string): '\n' | '\r\n' {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

export function lineIndent(source: string, lines: LineIndex, line: number): string {
  const text = lines.lineText(line);
  return /^\s*/.exec(text)?.[0] ?? '';
}

/**
 * Figure out how sequence items in this source are laid out. SS14 accepts both
 * `graph:\n- node` and `graph:\n  - node`, and both are found in the wild.
 */
export function sequenceLayout(
  source: string,
  lines: LineIndex,
  seq: Node | null,
  fallbackIndent: number,
): { dashIndent: number; contentIndent: number } {
  const first = seq && isSeq(seq) ? ((seq.items[0] as Node | undefined) ?? null) : null;
  if (first?.range) {
    const line = lines.lineAt(first.range[0]);
    const lineStart = lines.lineStart(line);
    const lineText = lines.lineText(line);
    const dash = /^(\s*)-/.exec(lineText);
    if (dash) {
      const dashIndent = dash[1]!.length;
      const keyColumn = first.range[0] - lineStart;
      return {
        dashIndent,
        contentIndent:
          keyColumn > dashIndent ? keyColumn : dashIndent + 2,
      };
    }
    const before = source.slice(lineStart, first.range[0]);
    if (/^\s*$/.test(before)) {
      return { dashIndent: before.length, contentIndent: before.length + 2 };
    }
  }
  return { dashIndent: fallbackIndent, contentIndent: fallbackIndent + 2 };
}

export function mapContentIndent(
  source: string,
  lines: LineIndex,
  span: SourceSpan,
): number {
  const line = lines.lineText(span.line);
  const dash = /^(\s*)-\s+/.exec(line);
  if (dash && span.start - lines.lineStart(span.line) >= dash[0].length) {
    return line.length - line.trimStart().length + dash[0].length - dash[1]!.length - 2;
  }
  return line.length - line.trimStart().length;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
