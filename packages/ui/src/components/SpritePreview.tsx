import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { RsiStateView, SpriteInfo } from '@ss14-studio/core';
import type { IconSheet } from '../lib/host';

export interface SpriteFrameSource {
  uri: string;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
}

export function sheetFromIcon(icon: IconSheet | undefined): SpriteFrameSource | null {
  if (!icon) return null;
  return {
    uri: icon.uri,
    width: icon.width,
    height: icon.height,
    frameWidth: icon.frameWidth,
    frameHeight: icon.frameHeight,
  };
}

export function frameStyle(
  sheet: SpriteFrameSource,
  frameIndex: number,
  size: number,
  options: { fit?: 'contain' | 'cover'; pixelated?: boolean } = {},
): CSSProperties {
  const columns = Math.max(1, Math.floor(sheet.width / Math.max(1, sheet.frameWidth)));
  const column = ((frameIndex % columns) + columns) % columns;
  const row = Math.max(0, Math.floor(frameIndex / columns));
  const scale = size / Math.max(1, sheet.frameWidth);
  return {
    width: size,
    height: size,
    backgroundImage: `url("${sheet.uri}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${sheet.width * scale}px ${sheet.height * scale}px`,
    backgroundPosition: `${-column * sheet.frameWidth * scale}px ${-row * sheet.frameHeight * scale}px`,
    imageRendering: options.pixelated === false ? undefined : 'pixelated',
    objectFit: options.fit,
  };
}

export function SpriteFrame({
  sheet,
  frameIndex = 0,
  size = 32,
  className = '',
  title,
}: {
  sheet: SpriteFrameSource;
  frameIndex?: number;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`sprite-frame ${className}`.trim()}
      style={frameStyle(sheet, frameIndex, size)}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
    />
  );
}

export function EntitySprite({
  entityId,
  icons,
  size = 28,
  className = '',
  animate = false,
}: {
  entityId: string | null | undefined;
  icons: Record<string, IconSheet>;
  size?: number;
  className?: string;
  animate?: boolean;
}) {
  const sheet = entityId ? sheetFromIcon(icons[entityId]) : null;
  const [frame, setFrame] = useState(0);
  const frameCount = useMemo(() => {
    if (!sheet) return 1;
    const columns = Math.max(1, Math.floor(sheet.width / sheet.frameWidth));
    const rows = Math.max(1, Math.floor(sheet.height / sheet.frameHeight));
    return Math.max(1, Math.min(columns * rows, 8));
  }, [sheet]);

  useEffect(() => {
    setFrame(0);
    if (!animate || !sheet || frameCount <= 1) return;
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % frameCount);
    }, 240);
    return () => window.clearInterval(timer);
  }, [animate, frameCount, sheet]);

  if (!sheet) {
    return (
      <span className={`sprite-fallback ${className}`.trim()} style={{ width: size, height: size }}>
        <span>{initials(entityId ?? '?')}</span>
      </span>
    );
  }

  return (
    <span className={`entity-sprite ${className}`.trim()}>
      <SpriteFrame sheet={sheet} frameIndex={frame} size={size} />
    </span>
  );
}

export function RsiAnimation({
  state,
  size = 128,
  playing = true,
  direction = 0,
  frame: controlledFrame,
  speed = 1,
  onFrame,
}: {
  state: RsiStateView | null;
  size?: number;
  playing?: boolean;
  direction?: number;
  frame?: number;
  speed?: number;
  onFrame?: (frame: number) => void;
}) {
  const [internal, setInternal] = useState(0);
  const frames = state?.directionIndices[direction] ?? state?.directionIndices[0] ?? [];
  const delays = state?.delays[direction] ?? state?.delays[0] ?? [];
  const frame = controlledFrame ?? internal;
  const localIndex = Math.max(0, frames.indexOf(frame));

  useEffect(() => {
    setInternal(0);
  }, [state?.name, direction]);

  useEffect(() => {
    if (!playing || !state || frames.length <= 1) return;
    const delay = Math.max(0.03, (delays[localIndex] ?? 0.1) / Math.max(0.1, speed));
    const timer = window.setTimeout(() => {
      const next = frames[(localIndex + 1) % frames.length] ?? frames[0] ?? 0;
      setInternal(next);
      onFrame?.(next);
    }, delay * 1000);
    return () => window.clearTimeout(timer);
  }, [delays, frames, localIndex, onFrame, playing, speed, state]);

  if (!state || !state.image.uri) {
    return (
      <div className="rsi-animation-empty" style={{ width: size, height: size }}>
        <span>No image</span>
      </div>
    );
  }

  const sheet: SpriteFrameSource = {
    uri: state.image.uri,
    width: state.image.width,
    height: state.image.height,
    frameWidth: state.frameWidth,
    frameHeight: state.frameHeight,
  };

  return (
    <span className="rsi-animation" style={{ width: size, height: size }}>
      <SpriteFrame sheet={sheet} frameIndex={frame} size={size} />
    </span>
  );
}

export function SpritePath({
  sprite,
  icons,
  entityId,
  size = 36,
}: {
  sprite: SpriteInfo | null;
  icons?: Record<string, IconSheet>;
  entityId?: string;
  size?: number;
}) {
  if (!sprite) {
    return (
      <span className="sprite-path-empty" style={{ width: size, height: size }}>
        ?
      </span>
    );
  }
  if (entityId && icons?.[entityId]) {
    return <EntitySprite entityId={entityId} icons={icons} size={size} />;
  }
  return (
    <span className="sprite-path" style={{ width: size, height: size }} title={sprite.rsi ?? sprite.texture ?? ''}>
      <span>{initials(sprite.state ?? sprite.rsi ?? '?')}</span>
    </span>
  );
}

function initials(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/);
  return words.length > 1
    ? `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase()
    : clean.slice(0, 2).toUpperCase();
}
