import type { SpriteInfo, SpriteLayerInfo } from '@ss14-studio/core';

export interface EditableSpriteLayer {
  rsi: string;
  state: string;
  color: string;
  scale: string;
  offsetX: string;
  offsetY: string;
  visible: boolean;
}

export function layersFromSprite(sprite: SpriteInfo | null): EditableSpriteLayer[] {
  if (!sprite) return [];
  const layers =
    sprite.layers && sprite.layers.length > 0
      ? sprite.layers
      : [
          {
            rsi: sprite.rsi,
            state: sprite.state ?? sprite.layerState ?? 'icon',
            color: sprite.color ?? null,
            scale: sprite.scale ?? null,
            offset: sprite.offset ?? null,
            visible: sprite.visible !== false,
          } as SpriteLayerInfo,
        ];
  return layers.map((layer) => ({
    rsi: layer.rsi ?? layer.texture ?? '',
    state: layer.state ?? 'icon',
    color: layer.color ?? '',
    scale: layer.scale == null ? '1' : String(layer.scale),
    offsetX: String(layer.offset?.x ?? 0),
    offsetY: String(layer.offset?.y ?? 0),
    visible: layer.visible !== false,
  }));
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function layerFields(layer: EditableSpriteLayer): Record<string, unknown> {
  const scale = numberOrNull(layer.scale);
  const x = numberOrNull(layer.offsetX);
  const y = numberOrNull(layer.offsetY);
  return {
    ...(layer.rsi.trim() ? { sprite: layer.rsi.trim() } : {}),
    ...(layer.state.trim() ? { state: layer.state.trim() } : {}),
    ...(layer.color.trim() ? { color: layer.color.trim() } : {}),
    ...(scale != null && scale !== 1 ? { scale } : {}),
    ...(x != null || y != null
      ? { offset: [x ?? 0, y ?? 0] }
      : {}),
    ...(layer.visible === false ? { visible: false } : {}),
  };
}

/**
 * Build the fields for a Sprite (or Icon) component override. The first layer
 * becomes the compact base sprite; additional layers are written to `layers`.
 */
export function spriteComponentFields(
  sprite: SpriteInfo,
  layers: readonly EditableSpriteLayer[],
  component = sprite.component ?? 'Sprite',
): Record<string, unknown> {
  const clean = layers.filter((layer) => layer.rsi.trim() || layer.state.trim());
  const base = clean[0];
  if (!base) return {};
  if (component === 'Icon') {
    return {
      icon: {
        ...(base.rsi.trim() ? { sprite: base.rsi.trim() } : {}),
        ...(base.state.trim() ? { state: base.state.trim() } : {}),
      },
    };
  }
  const fields: Record<string, unknown> = {
    ...(sprite.extra ?? {}),
    ...(base.rsi.trim() ? { sprite: base.rsi.trim() } : {}),
    ...(base.state.trim() ? { state: base.state.trim() } : {}),
    ...(base.color.trim() ? { color: base.color.trim() } : {}),
    ...(numberOrNull(base.scale) != null && numberOrNull(base.scale) !== 1
      ? { scale: numberOrNull(base.scale) }
      : {}),
    ...(numberOrNull(base.offsetX) != null || numberOrNull(base.offsetY) != null
      ? { offset: [numberOrNull(base.offsetX) ?? 0, numberOrNull(base.offsetY) ?? 0] }
      : {}),
    ...(base.visible === false ? { visible: false } : {}),
    ...(sprite.rotation != null ? { rotation: sprite.rotation } : {}),
  };
  if (clean.length > 1) {
    fields.layers = clean.map((layer) => layerFields(layer));
  }
  return fields;
}

export function emptySpriteLayer(base?: EditableSpriteLayer): EditableSpriteLayer {
  return {
    rsi: base?.rsi ?? '',
    state: base?.state ?? 'icon',
    color: '',
    scale: '1',
    offsetX: '0',
    offsetY: '0',
    visible: true,
  };
}
