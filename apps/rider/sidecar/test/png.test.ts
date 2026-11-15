import { describe, expect, it } from 'vitest';
import {
  createTransparentPng,
  dataUrl,
  decodeDataUrl,
  pngDimensions,
} from '../src/png.js';

describe('PNG helpers', () => {
  it('creates a valid transparent PNG with the requested dimensions', () => {
    const bytes = createTransparentPng(8, 4);
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(pngDimensions(bytes)).toEqual({ width: 8, height: 4 });
  });

  it('rounds and clamps dimensions to at least one pixel', () => {
    expect(pngDimensions(createTransparentPng(0, 0))).toEqual({ width: 1, height: 1 });
    expect(pngDimensions(createTransparentPng(4.7, 2.2))).toEqual({ width: 5, height: 2 });
  });

  it('rejects non-PNG data and short headers', () => {
    expect(pngDimensions(new Uint8Array([]))).toBeNull();
    expect(pngDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(pngDimensions(new TextEncoder().encode('not a png image at all'))).toBeNull();
  });

  it('round-trips data URLs', () => {
    const bytes = createTransparentPng(2, 2);
    const url = dataUrl(bytes);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(decodeDataUrl(url)).toEqual(bytes);
    expect(decodeDataUrl(`  ${url}  `)).toEqual(bytes);
    expect(decodeDataUrl('data:image/jpeg;base64,AAAA')).toBeNull();
    expect(decodeDataUrl('https://example.com/image.png')).toBeNull();
  });
});
