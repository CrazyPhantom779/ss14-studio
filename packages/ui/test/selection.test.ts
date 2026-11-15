import { describe, expect, it } from 'vitest';
import { isSameSelection } from '../src/lib/selection.js';

describe('selection identity', () => {
  it('compares node selections by name', () => {
    expect(isSameSelection({ kind: 'node', node: 'start' }, { kind: 'node', node: 'start' })).toBe(
      true,
    );
    expect(isSameSelection({ kind: 'node', node: 'start' }, { kind: 'node', node: 'frame' })).toBe(
      false,
    );
  });

  it('compares edge selections by source and edge index', () => {
    expect(
      isSameSelection(
        { kind: 'edge', from: 'start', to: 'frame', index: 0 },
        { kind: 'edge', from: 'start', to: 'frame', index: 0 },
      ),
    ).toBe(true);
    expect(
      isSameSelection(
        { kind: 'edge', from: 'start', to: 'frame', index: 0 },
        { kind: 'edge', from: 'start', to: 'frame', index: 1 },
      ),
    ).toBe(false);
  });

  it('does not consider different kinds or empty selections equal', () => {
    expect(
      isSameSelection(
        { kind: 'node', node: 'start' },
        { kind: 'edge', from: 'start', to: 'frame', index: 0 },
      ),
    ).toBe(false);
    expect(isSameSelection(null, null)).toBe(true);
    expect(isSameSelection(null, { kind: 'node', node: 'start' })).toBe(false);
    expect(isSameSelection({ kind: 'node', node: 'start' }, null)).toBe(false);
  });
});
