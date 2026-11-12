export type StudioSelection =
  | { kind: 'node'; node: string }
  | { kind: 'edge'; from: string; to: string; index: number };

export function isSameSelection(
  left: StudioSelection | null,
  right: StudioSelection | null,
): boolean {
  if (!left || !right) return left === right;
  if (left.kind === 'node' && right.kind === 'node') return left.node === right.node;
  if (left.kind === 'edge' && right.kind === 'edge') {
    return left.from === right.from && left.index === right.index;
  }
  return false;
}
