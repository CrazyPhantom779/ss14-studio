import { describe, expect, it } from 'vitest';
import type { SpriteInfo } from '@ss14-studio/core';
import {
  emptySpriteLayer,
  layersFromSprite,
  spriteComponentFields,
} from '../src/lib/sprite.js';

const baseSprite: SpriteInfo = {
  rsi: 'Textures/Objects/tool.rsi',
  state: 'icon',
  layerState: 'icon',
  color: '#00ff00',
  scale: 2,
  offset: { x: 0.5, y: -0.25 },
  rotation: 90,
  visible: true,
  component: 'Sprite',
  texture: null,
  extra: { drawdepth: 'Items' },
};

describe('sprite layer editing', () => {
  it('returns no layers for a missing sprite', () => {
    expect(layersFromSprite(null)).toEqual([]);
  });

  it('falls back to the compact sprite fields', () => {
    expect(layersFromSprite(baseSprite)).toEqual([
      {
        rsi: 'Textures/Objects/tool.rsi',
        state: 'icon',
        color: '#00ff00',
        scale: '2',
        offsetX: '0.5',
        offsetY: '-0.25',
        visible: true,
      },
    ]);
  });

  it('uses texture paths and defaults for partial layers', () => {
    const sprite: SpriteInfo = {
      ...baseSprite,
      layers: [
        {
          index: 0,
          rsi: null,
          state: null,
          texture: 'Textures/Objects/overlay.png',
          color: null,
          scale: null,
          offset: null,
          visible: false,
          map: null,
          fields: {},
        },
      ],
    };
    expect(layersFromSprite(sprite)).toEqual([
      {
        rsi: 'Textures/Objects/overlay.png',
        state: 'icon',
        color: '',
        scale: '1',
        offsetX: '0',
        offsetY: '0',
        visible: false,
      },
    ]);
  });

  it('creates a new layer from a base layer', () => {
    expect(emptySpriteLayer({ ...layersFromSprite(baseSprite)[0]! })).toEqual({
      rsi: 'Textures/Objects/tool.rsi',
      state: 'icon',
      color: '',
      scale: '1',
      offsetX: '0',
      offsetY: '0',
      visible: true,
    });
    expect(emptySpriteLayer()).toMatchObject({ rsi: '', state: 'icon', visible: true });
  });
});

describe('sprite component serialisation', () => {
  it('writes the first layer as the compact sprite fields', () => {
    const fields = spriteComponentFields(baseSprite, layersFromSprite(baseSprite));
    expect(fields).toEqual({
      drawdepth: 'Items',
      sprite: 'Textures/Objects/tool.rsi',
      state: 'icon',
      color: '#00ff00',
      scale: 2,
      offset: [0.5, -0.25],
      rotation: 90,
    });
  });

  it('omits identity values and writes additional layers', () => {
    const fields = spriteComponentFields(baseSprite, [
      {
        rsi: 'Textures/Objects/tool.rsi',
        state: 'icon',
        color: '',
        scale: '1',
        offsetX: '0',
        offsetY: '0',
        visible: true,
      },
      {
        rsi: '',
        state: 'overlay',
        color: '#ff0000',
        scale: '1.5',
        offsetX: '0',
        offsetY: '2',
        visible: false,
      },
    ]);
    expect(fields).toEqual({
      drawdepth: 'Items',
      sprite: 'Textures/Objects/tool.rsi',
      state: 'icon',
      offset: [0, 0],
      rotation: 90,
      layers: [
        {
          sprite: 'Textures/Objects/tool.rsi',
          state: 'icon',
          offset: [0, 0],
        },
        {
          state: 'overlay',
          color: '#ff0000',
          scale: 1.5,
          offset: [0, 2],
          visible: false,
        },
      ],
    });
  });

  it('writes Icon components using the nested icon mapping', () => {
    expect(
      spriteComponentFields(
        { ...baseSprite, component: 'Icon' },
        [
          {
            rsi: 'Textures/Objects/tool.rsi',
            state: 'icon',
            color: '#00ff00',
            scale: '2',
            offsetX: '0',
            offsetY: '0',
            visible: true,
          },
        ],
        'Icon',
      ),
    ).toEqual({
      icon: {
        sprite: 'Textures/Objects/tool.rsi',
        state: 'icon',
      },
    });
  });

  it('skips blank layers and returns an empty mapping when none remain', () => {
    expect(
      spriteComponentFields(baseSprite, [
        {
          rsi: '',
          state: '',
          color: '#fff',
          scale: '1',
          offsetX: '0',
          offsetY: '0',
          visible: true,
        },
      ]),
    ).toEqual({});
  });
});
