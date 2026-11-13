import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { RsiStateView } from '@ss14-studio/core';
import {
  Boxes,
  Brush,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Eraser,
  FileImage,
  Film,
  Image as ImageIcon,
  Info,
  Layers,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import type { StudioHost } from '../lib/host';
import { Badge, Button, IconButton } from './ui';
import { RsiAnimation } from './SpritePreview';

type EditorTool = 'pencil' | 'eraser' | 'fill';

const DIRECTION_NAMES = [
  'South',
  'North',
  'East',
  'West',
  'South-east',
  'South-west',
  'North-east',
  'North-west',
];

export function RsiStudio({ host }: { host: StudioHost }) {
  const view = host.rsi;
  const [stateName, setStateName] = useState<string | null>(null);
  const [direction, setDirection] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(4);
  const [tool, setTool] = useState<EditorTool>('pencil');
  const [color, setColor] = useState('#ffffff');
  const [showEditor, setShowEditor] = useState(false);
  const [addingState, setAddingState] = useState(false);
  const [newState, setNewState] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);

  const state = useMemo(
    () => view?.states.find((candidate) => candidate.name === stateName) ?? view?.states[0] ?? null,
    [stateName, view],
  );

  useEffect(() => {
    if (view && (!stateName || !view.states.some((candidate) => candidate.name === stateName))) {
      setStateName(view.states[0]?.name ?? null);
    }
  }, [stateName, view]);

  useEffect(() => {
    setDirection(0);
    setFrame(0);
    setPlaying(true);
    setShowEditor(false);
    setRenaming(false);
  }, [state?.name]);

  useEffect(() => {
    if (!state) return;
    const frames = state.directionIndices[direction] ?? state.directionIndices[0] ?? [];
    if (!frames.includes(frame)) setFrame(frames[0] ?? 0);
  }, [direction, frame, state]);

  const operation = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <div className="studio-detail-empty">
        <span className="detail-empty-icon"><ImageIcon size={30} aria-hidden /></span>
        <h2>No RSI opened</h2>
        <p>Open an RSI from the prototype explorer, the editor title bar, or the command palette.</p>
        <Button icon={ImageIcon} onClick={host.pickRsi}>Open RSI folder</Button>
      </div>
    );
  }

  const updateMeta = (field: 'license' | 'copyright' | 'metaAtlas' | 'rsic' | 'version', value: string | number | boolean | null) =>
    operation(() => host.applyRsiOperation(view.dirPath, { kind: 'setMeta', field, value }));

  return (
    <div className="rsi-studio">
      <header className="studio-page-head">
        <div>
          <div className="prototype-eyebrow">
            <Badge tone="accent">RSI</Badge>
            <code>{view.relativePath}</code>
            {view.metaAtlas ? <Badge tone="muted">atlas</Badge> : <Badge tone="warning">non-atlas</Badge>}
          </div>
          <h1>{baseName(view.relativePath)}</h1>
          <p className="studio-page-sub">
            {view.states.length} states · {view.size.x}×{view.size.y}px frames · {view.license ?? 'no license'} ·{' '}
            {view.copyright ?? 'no copyright'}
          </p>
        </div>
        <div className="studio-page-actions">
          <Button icon={RefreshCw} size="sm" busy={busy} onClick={() => operation(() => host.applyRsiOperation(view.dirPath, { kind: 'cleanup' }))}>
            Clean up
          </Button>
          <Button icon={FileImage} size="sm" onClick={() => host.openPath(view.metaPath)}>
            meta.json
          </Button>
        </div>
      </header>

      <div className="rsi-layout">
        <aside className="rsi-states">
          <header>
            <h3><Layers size={14} aria-hidden /> States <Badge tone="muted">{view.states.length}</Badge></h3>
            <IconButton icon={Plus} label="Add state" onClick={() => setAddingState(true)} />
          </header>
          {addingState ? (
            <form
              className="rsi-add-state"
              onSubmit={(event) => {
                event.preventDefault();
                if (!newState.trim()) return;
                setAddingState(false);
                void operation(() =>
                  host.applyRsiOperation(view.dirPath, {
                    kind: 'addState',
                    state: { name: newState.trim(), directions: 1, delays: [[0.1]] },
                  }),
                ).then(() => setStateName(newState.trim()));
                setNewState('');
              }}
            >
              <input autoFocus value={newState} onChange={(event) => setNewState(event.target.value)} placeholder="state name" />
              <IconButton icon={Check} label="Create state" onClick={() => undefined} type="submit" />
            </form>
          ) : null}
          <div className="rsi-state-list">
            {view.states.map((candidate) => {
              const image = candidate.image;
              return (
                <button
                  type="button"
                  key={candidate.name}
                  className={`rsi-state-row ${candidate.name === state?.name ? 'active' : ''}`}
                  onClick={() => setStateName(candidate.name)}
                >
                  <span className="rsi-state-thumb">
                    {image.uri ? (
                      <RsiAnimation state={candidate} size={40} playing={false} direction={0} frame={0} />
                    ) : (
                      <ImageIcon size={16} aria-hidden />
                    )}
                  </span>
                  <span className="rsi-state-main">
                    <strong>{candidate.name}</strong>
                    <span>
                      {candidate.directions} dir · {candidate.frameCount} frame{candidate.frameCount === 1 ? '' : 's'}
                    </span>
                  </span>
                  {candidate.missing ? <CircleAlert size={13} className="missing" aria-hidden /> : null}
                </button>
              );
            })}
            {view.states.length === 0 ? <div className="studio-list-empty small"><ImageIcon size={18} aria-hidden /><span>No states</span></div> : null}
          </div>
          {view.diagnostics.length > 0 ? (
            <div className="rsi-diagnostics">
              {view.diagnostics.slice(0, 8).map((diagnostic, index) => (
                <div key={index} className={`rsi-diagnostic ${diagnostic.severity}`}>
                  {diagnostic.severity === 'error' ? <CircleAlert size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />}
                  <span>{diagnostic.message}</span>
                </div>
              ))}
            </div>
          ) : null}
          {view.orphanImages.length > 0 ? (
            <div className="rsi-orphans">
              <div className="card-subhead">Unreferenced images</div>
              {view.orphanImages.map((file) => (
                <div key={file} className="rsi-orphan">
                  <code>{file}</code>
                  <IconButton
                    icon={Trash2}
                    label={`Delete ${file}`}
                    onClick={() =>
                      void operation(() =>
                        host.deleteRsiImage(view.dirPath, file.replace(/\.png$/i, '')),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
        </aside>

        <main className="rsi-main">
          {state ? (
            <>
              <section className="rsi-preview-card">
                <header>
                  <div>
                    {renaming ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          setRenaming(false);
                          if (renameValue.trim() && renameValue.trim() !== state.name) {
                            void operation(() =>
                              host.applyRsiOperation(view.dirPath, {
                                kind: 'renameState',
                                state: state.name,
                                name: renameValue.trim(),
                              }),
                            ).then(() => setStateName(renameValue.trim()));
                          }
                        }}
                      >
                        <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                      </form>
                    ) : (
                      <h2>{state.name}</h2>
                    )}
                    <span>
                      {state.directions} direction{state.directions === 1 ? '' : 's'} · {state.frameCount} frames ·{' '}
                      {state.totalDuration.toFixed(2)}s loop
                    </span>
                  </div>
                  <div className="rsi-preview-tools">
                    <IconButton
                      icon={Pencil}
                      label="Rename state"
                      onClick={() => {
                        setRenameValue(state.name);
                        setRenaming(true);
                      }}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Remove state"
                      onClick={() => {
                        if (window.confirm(`Remove state "${state.name}" and its PNG?`)) {
                          void operation(() => host.applyRsiOperation(view.dirPath, { kind: 'removeState', state: state.name }));
                        }
                      }}
                    />
                  </div>
                </header>

                <div className={`rsi-preview-stage ${showEditor ? 'editor-open' : ''}`}>
                  <div className="rsi-preview-canvas">
                    <RsiAnimation
                      state={state}
                      size={128 * (zoom / 4)}
                      playing={playing}
                      direction={direction}
                      frame={frame}
                      speed={speed}
                      onFrame={setFrame}
                    />
                    <div className="rsi-frame-caption">
                      frame {Math.max(0, (state.directionIndices[direction] ?? []).indexOf(frame)) + 1} /{' '}
                      {state.directionFrames[direction] ?? 0} · {DIRECTION_NAMES[direction] ?? `direction ${direction + 1}`}
                    </div>
                  </div>
                  <div className="rsi-playback">
                    <div className="rsi-transport">
                      <IconButton
                        icon={ChevronLeft}
                        label="Previous frame"
                        onClick={() => {
                          const frames = state.directionIndices[direction] ?? [];
                          if (!frames.length) return;
                          const index = Math.max(0, frames.indexOf(frame));
                          setFrame(frames[(index - 1 + frames.length) % frames.length] ?? frames[0]!);
                          setPlaying(false);
                        }}
                      />
                      <IconButton icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'} active={playing} onClick={() => setPlaying((value) => !value)} />
                      <IconButton
                        icon={ChevronRight}
                        label="Next frame"
                        onClick={() => {
                          const frames = state.directionIndices[direction] ?? [];
                          if (!frames.length) return;
                          const index = Math.max(0, frames.indexOf(frame));
                          setFrame(frames[(index + 1) % frames.length] ?? frames[0]!);
                          setPlaying(false);
                        }}
                      />
                    </div>
                    <label className="rsi-control">
                      <span>Direction</span>
                      <select value={direction} onChange={(event) => setDirection(Number(event.target.value))}>
                        {(state.directionIndices.length ? state.directionIndices : [[0]]).map((_, index) => (
                          <option key={index} value={index}>
                            {DIRECTION_NAMES[index] ?? `Direction ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="rsi-control">
                      <span>Speed</span>
                      <input type="range" min={0.25} max={3} step={0.25} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
                      <em>{speed}×</em>
                    </label>
                    <label className="rsi-control">
                      <span>Zoom</span>
                      <input type="range" min={1} max={8} step={1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
                      <em>{zoom}×</em>
                    </label>
                    <div className="rsi-preview-actions">
                      <Button size="sm" icon={Upload} onClick={() => operation(() => host.importRsiFrames(view.dirPath, state.name))}>
                        Replace PNG
                      </Button>
                      <Button size="sm" icon={Brush} active={showEditor} onClick={() => setShowEditor((value) => !value)}>
                        Pixel editor
                      </Button>
                    </div>
                  </div>
                </div>

                {showEditor && state.image.uri ? (
                  <PixelEditor
                    view={view}
                    state={state}
                    frame={frame}
                    zoom={zoom}
                    tool={tool}
                    color={color}
                    onTool={setTool}
                    onColor={setColor}
                    onSave={async (dataUrl) => {
                      await operation(() => host.saveRsiPng(view.dirPath, state.name, dataUrl));
                    }}
                  />
                ) : null}

                <footer className="rsi-state-settings">
                  <label>
                    <span>Directions</span>
                    <div className="segmented">
                      {[1, 4, 8].map((count) => (
                        <button
                          type="button"
                          key={count}
                          className={state.directions === count ? 'active' : ''}
                          onClick={() => operation(() => host.applyRsiOperation(view.dirPath, { kind: 'setDirections', state: state.name, directions: count }))}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </label>
                  <div className="rsi-frame-buttons">
                    <Button size="sm" icon={Plus} onClick={() => operation(() => host.applyRsiOperation(view.dirPath, { kind: 'addFrame', state: state.name }))}>
                      Add frame
                    </Button>
                    <Button size="sm" icon={Copy} onClick={() => operation(() => host.applyRsiOperation(view.dirPath, { kind: 'duplicateFrame', state: state.name, direction, frame }))}>
                      Duplicate frame
                    </Button>
                    <Button
                      size="sm"
                      icon={Trash2}
                      disabled={state.frameCount <= 1}
                      onClick={() => operation(() => host.applyRsiOperation(view.dirPath, { kind: 'removeFrame', state: state.name, direction, frame }))}
                    >
                      Remove frame
                    </Button>
                  </div>
                </footer>
              </section>

              <section className="studio-card rsi-delays">
                <header className="studio-card-head">
                  <h3><Film size={14} aria-hidden /> Frame delays</h3>
                  <span className="muted">Seconds per frame, per direction. All directions share frame counts.</span>
                </header>
                <div className="delay-grid" style={{ gridTemplateColumns: `120px repeat(${state.directionFrames[0] ?? 1}, minmax(54px, 1fr))` }}>
                  <span className="delay-head" />
                  {Array.from({ length: state.directionFrames[0] ?? 1 }, (_, index) => (
                    <span className="delay-head" key={index}>F{index + 1}</span>
                  ))}
                  {state.delays.map((delays, dirIndex) => (
                    <div className="delay-row" key={dirIndex} style={{ display: 'contents' }}>
                      <span className={`delay-direction ${direction === dirIndex ? 'active' : ''}`} onClick={() => setDirection(dirIndex)}>
                        {DIRECTION_NAMES[dirIndex] ?? `Direction ${dirIndex + 1}`}
                      </span>
                      {delays.map((delay, frameIndex) => (
                        <input
                          key={frameIndex}
                          type="number"
                          min={0}
                          step={0.05}
                          value={delay}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (!Number.isFinite(next)) return;
                            void host.applyRsiOperation(view.dirPath, {
                              kind: 'setFrameDelay',
                              state: state.name,
                              direction: dirIndex,
                              frame: frameIndex,
                              delay: next,
                            });
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="studio-detail-empty">
              <ImageIcon size={30} aria-hidden />
              <h2>This RSI has no states</h2>
              <Button icon={Plus} onClick={() => setAddingState(true)}>Add a state</Button>
            </div>
          )}
        </main>

        <aside className="rsi-meta">
          <section className="studio-card">
            <header className="studio-card-head"><h3>Metadata</h3></header>
            <label className="meta-field">
              <span>License</span>
              <input
                key={`license:${view.license}`}
                defaultValue={view.license ?? ''}
                placeholder="CC-BY-SA-3.0"
                onBlur={(event) => {
                  if (event.target.value !== (view.license ?? '')) void updateMeta('license', event.target.value || null);
                }}
              />
            </label>
            <label className="meta-field">
              <span>Copyright</span>
              <input
                key={`copyright:${view.copyright}`}
                defaultValue={view.copyright ?? ''}
                placeholder="Space Wizards Federation"
                onBlur={(event) => {
                  if (event.target.value !== (view.copyright ?? '')) void updateMeta('copyright', event.target.value || null);
                }}
              />
            </label>
            <div className="meta-size">
              <label>
                <span>Frame width</span>
                <input
                  type="number"
                  min={1}
                  key={`w:${view.size.x}`}
                  defaultValue={view.size.x}
                  onBlur={(event) => {
                    const width = Number(event.target.value);
                    if (Number.isFinite(width) && width !== view.size.x) {
                      void operation(() => host.applyRsiOperation(view.dirPath, { kind: 'setSize', width, height: view.size.y }));
                    }
                  }}
                />
              </label>
              <label>
                <span>Frame height</span>
                <input
                  type="number"
                  min={1}
                  key={`h:${view.size.y}`}
                  defaultValue={view.size.y}
                  onBlur={(event) => {
                    const height = Number(event.target.value);
                    if (Number.isFinite(height) && height !== view.size.y) {
                      void operation(() => host.applyRsiOperation(view.dirPath, { kind: 'setSize', width: view.size.x, height }));
                    }
                  }}
                />
              </label>
            </div>
            <label className="settings-toggle inline">
              <span>
                <strong>Use meta atlas</strong>
                <em>Disable for non-atlas sprites.</em>
              </span>
              <input
                type="checkbox"
                checked={view.metaAtlas}
                onChange={(event) => void updateMeta('metaAtlas', event.target.checked)}
              />
            </label>
            <label className="settings-toggle inline">
              <span>
                <strong>RSIC compression</strong>
                <em>Turn off to disable .rsic files.</em>
              </span>
              <input
                type="checkbox"
                checked={view.rsic}
                onChange={(event) => void updateMeta('rsic', event.target.checked)}
              />
            </label>
          </section>

          <section className="studio-card">
            <header className="studio-card-head"><h3><Info size={14} aria-hidden /> State image</h3></header>
            <dl className="meta-list">
              <div><dt>File</dt><dd>{state?.image.path ?? '—'}</dd></div>
              <div><dt>Sheet</dt><dd>{state?.image.width ?? 0}×{state?.image.height ?? 0}</dd></div>
              <div><dt>Grid</dt><dd>{state?.columns ?? 0}×{state?.rows ?? 0}</dd></div>
              <div><dt>Frames</dt><dd>{state?.frameCount ?? 0}</dd></div>
              <div><dt>Duration</dt><dd>{state?.totalDuration.toFixed(2) ?? '0'}s</dd></div>
            </dl>
            {state?.image.exists ? (
              <Button
                icon={Trash2}
                size="sm"
                variant="danger"
                onClick={() => {
                  if (state && window.confirm(`Delete ${state.name}.png? This removes the state image.`)) {
                    void operation(() => host.deleteRsiImage(view.dirPath, state.name));
                  }
                }}
              >
                Delete state PNG
              </Button>
            ) : (
              <Button icon={Upload} size="sm" onClick={() => state && operation(() => host.importRsiFrames(view.dirPath, state.name))}>
                Import state PNG
              </Button>
            )}
          </section>

          <section className="studio-card rsi-help">
            <header className="studio-card-head"><h3><Sparkles size={14} aria-hidden /> RSI notes</h3></header>
            <p>
              Directional frames are stored in direction order inside one row-major sheet. SS14 Studio
              computes each direction’s offset from the delay lists, exactly like RobustToolbox.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function baseName(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/');
  return parts[parts.length - 1] ?? path;
}

function PixelEditor({
  view,
  state,
  frame,
  zoom,
  tool,
  color,
  onTool,
  onColor,
  onSave,
}: {
  view: NonNullable<StudioHost['rsi']>;
  state: RsiStateView;
  frame: number;
  zoom: number;
  tool: EditorTool;
  color: string;
  onTool: (tool: EditorTool) => void;
  onColor: (color: string) => void;
  onSave: (dataUrl: string) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state.image.uri) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = state.image.width;
      canvas.height = state.image.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0);
      context.putImageData(snapOpaque(context.getImageData(0, 0, canvas.width, canvas.height)), 0, 0);
      setReady(true);
      setDirty(false);
    };
    image.src = state.image.uri;
    return () => {
      cancelled = true;
    };
  }, [state.image.height, state.image.uri, state.image.width]);

  const columns = Math.max(1, state.columns);
  const frameX = (frame % columns) * state.frameWidth;
  const frameY = Math.floor(frame / columns) * state.frameHeight;

  const paint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    if (x < frameX || y < frameY || x >= frameX + state.frameWidth || y >= frameY + state.frameHeight) return;
    if (tool === 'fill') {
      floodFill(context, canvas.width, canvas.height, x, y, color, frameX, frameY, state.frameWidth, state.frameHeight);
    } else {
      context.fillStyle = tool === 'eraser' ? 'rgba(0,0,0,0)' : color;
      context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      context.fillRect(x, y, 1, 1);
      context.globalCompositeOperation = 'source-over';
    }
    setDirty(true);
  };

  return (
    <div className="pixel-editor">
      <header>
        <h3><Brush size={14} aria-hidden /> Pixel editor</h3>
        <div className="pixel-tools">
          <IconButton icon={Pencil} label="Pencil" active={tool === 'pencil'} onClick={() => onTool('pencil')} />
          <IconButton icon={Eraser} label="Eraser" active={tool === 'eraser'} onClick={() => onTool('eraser')} />
          <IconButton icon={Boxes} label="Fill" active={tool === 'fill'} onClick={() => onTool('fill')} />
          <input type="color" value={color} onChange={(event) => onColor(event.target.value)} aria-label="Pixel colour" />
        </div>
        <div className="pixel-actions">
          <Button size="sm" icon={Trash2} onClick={() => {
            const canvas = canvasRef.current;
            const context = canvas?.getContext('2d');
            if (canvas && context) {
              context.clearRect(frameX, frameY, state.frameWidth, state.frameHeight);
              setDirty(true);
            }
          }}>
            Clear frame
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={Save}
            busy={saving}
            disabled={!dirty}
            onClick={async () => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              setSaving(true);
              try {
                await onSave(canvas.toDataURL('image/png'));
                setDirty(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save sheet
          </Button>
        </div>
      </header>
      <div className="pixel-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="pixel-canvas"
          style={{
            width: Math.min(640, view.size.x * (state.columns ?? 1) * Math.max(1, zoom)),
            imageRendering: 'pixelated',
            cursor: tool === 'eraser' ? 'cell' : 'crosshair',
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            paint(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) paint(event);
          }}
        />
      </div>
      <p className="pixel-hint">
        Editing frame {Math.max(0, state.directionIndices.flat().indexOf(frame)) + 1}. Pixel edits are written to{' '}
        <code>{state.image.path}</code> as a complete sheet.
      </p>
    </div>
  );
}

function snapOpaque(image: ImageData): ImageData {
  const data = image.data;
  for (let index = 3; index < data.length; index += 4) {
    data[index] = data[index]! < 8 ? 0 : 255;
  }
  return image;
}

function floodFill(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  startX: number,
  startY: number,
  hex: string,
  minX: number,
  minY: number,
  maxWidth: number,
  maxHeight: number,
): void {
  const data = context.getImageData(0, 0, width, height);
  const target = pixelAt(data, width, startX, startY);
  const fill = hexToRgba(hex);
  if (!target || !fill) return;
  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === fill[3]) return;
  const stack: [number, number][] = [[startX, startY]];
  const seen = new Set<number>();
  const maxX = minX + maxWidth;
  const maxY = minY + maxHeight;
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < minX || y < minY || x >= maxX || y >= maxY) continue;
    const key = y * width + x;
    if (seen.has(key)) continue;
    seen.add(key);
    const current = pixelAt(data, width, x, y);
    if (!current || !sameColor(current, target)) continue;
    setPixel(data, width, x, y, fill);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  context.putImageData(data, 0, 0);
}

function pixelAt(image: ImageData, width: number, x: number, y: number): number[] | null {
  const offset = (y * width + x) * 4;
  if (offset < 0 || offset + 3 >= image.data.length) return null;
  return [image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!, image.data[offset + 3]!];
}

function setPixel(image: ImageData, width: number, x: number, y: number, rgba: number[]): void {
  const offset = (y * width + x) * 4;
  image.data[offset] = rgba[0]!;
  image.data[offset + 1] = rgba[1]!;
  image.data[offset + 2] = rgba[2]!;
  image.data[offset + 3] = rgba[3]!;
}

function sameColor(left: number[], right: number[]): boolean {
  return left.every((value, index) => Math.abs(value - (right[index] ?? 0)) < 6);
}

function hexToRgba(hex: string): number[] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}
