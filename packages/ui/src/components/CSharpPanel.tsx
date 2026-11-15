import { useMemo, type ReactNode } from 'react';
import type { CSharpPeer, CSharpView } from '@ss14-studio/core';
import {
  Braces,
  Check,
  CircleAlert,
  Code2,
  FileCode2,
  GitBranch,
  Info,
  Layers,
  ListTree,
  TriangleAlert,
} from 'lucide-react';
import type { StudioHost } from '../lib/host';
import { Badge, Button } from './ui';

export function CSharpPanel({ host }: { host: StudioHost }) {
  const view = host.csharp;
  const sourceLines = useMemo(() => view?.source.split(/\r?\n/) ?? [], [view?.source]);

  if (!view) {
    return (
      <div className="studio-detail-empty">
        <span className="detail-empty-icon"><Braces size={30} aria-hidden /></span>
        <h2>No C# file opened</h2>
        <p>
          Open a C# file from the editor title bar, the explorer context menu, or the C#
          context button in the XAML studio.
        </p>
        <Button icon={Code2} onClick={host.pickCSharp}>Open C# file</Button>
      </div>
    );
  }

  const errors = view.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = view.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;

  return (
    <div className="csharp-studio">
      <header className="studio-page-head">
        <div>
          <div className="prototype-eyebrow">
            <Badge tone="accent">C#</Badge>
            <code>{view.relativePath}</code>
            {view.namespace ? <Badge tone="muted">{view.namespace}</Badge> : <Badge tone="warning">no namespace</Badge>}
          </div>
          <h1>{view.types[0]?.name ?? view.relativePath.split('/').pop()}</h1>
          <p className="studio-page-sub">
            {view.types.length} type(s) · {view.partialSiblings.length} partial sibling(s) ·{' '}
            {view.namespacePeers.length} namespace peer(s)
            {view.linkedXaml.length > 0 ? ` · ${view.linkedXaml.length} linked XAML` : ''}
          </p>
        </div>
        <div className="studio-page-actions">
          <Button icon={FileCode2} size="sm" onClick={() => host.openPath(view.filePath, 1)}>
            Open source
          </Button>
          {view.linkedCodeBehind ? (
            <Button icon={Braces} size="sm" onClick={() => host.openXaml(view.linkedCodeBehind!)}>
              Open XAML
            </Button>
          ) : null}
        </div>
      </header>

      <div className="csharp-layout">
        <main className="csharp-main">
          <section className="studio-card">
            <header className="studio-card-head">
              <h3><ListTree size={14} aria-hidden /> Declarations</h3>
              <Badge tone="muted">{view.types.length}</Badge>
            </header>
            <div className="csharp-type-list">
              {view.types.map((type) => (
                <button
                  type="button"
                  key={`${type.name}:${type.line}`}
                  onClick={() => host.openPath(view.filePath, type.line)}
                >
                  <Badge tone={type.partial ? 'success' : 'muted'}>{type.kind}{type.partial ? ' partial' : ''}</Badge>
                  <strong>{type.name}</strong>
                  {type.baseTypes.length > 0 ? <em> : {type.baseTypes.join(', ')}</em> : null}
                  <span>line {type.line}</span>
                </button>
              ))}
              {view.types.length === 0 ? <div className="table-empty">No type declarations were found.</div> : null}
            </div>
          </section>

          <section className="studio-card csharp-source-card">
            <header className="studio-card-head">
              <h3><Code2 size={14} aria-hidden /> Source</h3>
              <Badge tone="muted">{sourceLines.length} lines</Badge>
            </header>
            <div className="xaml-source csharp-source">
              <pre>
                {sourceLines.map((line, index) => (
                  <span key={index} className="source-line">
                    <em>{index + 1}</em>
                    <code>{line || ' '}</code>
                  </span>
                ))}
              </pre>
            </div>
          </section>
        </main>

        <aside className="csharp-side">
          <section className="studio-card">
            <header className="studio-card-head">
              <h3><CircleAlert size={14} aria-hidden /> Validation</h3>
              <Badge tone={errors > 0 ? 'danger' : warnings > 0 ? 'warning' : 'success'}>{view.diagnostics.length}</Badge>
            </header>
            {view.diagnostics.length === 0 ? (
              <div className="xaml-clean"><Check size={16} aria-hidden /> No C# context issues found.</div>
            ) : (
              <div className="xaml-diagnostics">
                {view.diagnostics.map((diagnostic, index) => (
                  <button type="button" key={index} className={`xaml-diagnostic ${diagnostic.severity}`} onClick={() => host.openPath(view.filePath, diagnostic.line)}>
                    {diagnostic.severity === 'error' ? <CircleAlert size={12} aria-hidden /> : diagnostic.severity === 'warning' ? <TriangleAlert size={12} aria-hidden /> : <Info size={12} aria-hidden />}
                    <span>{diagnostic.message}</span>
                    <em>{diagnostic.line}</em>
                  </button>
                ))}
              </div>
            )}
          </section>

          <PeerCard
            title="Partial files"
            icon={<Layers size={14} aria-hidden />}
            peers={view.partialSiblings}
            empty="No other file declares the same type."
            onOpen={host.openCSharp}
          />

          <PeerCard
            title="Namespace peers"
            icon={<GitBranch size={14} aria-hidden />}
            peers={view.namespacePeers}
            empty="No other types share this namespace."
            onOpen={host.openCSharp}
          />

          <section className="studio-card">
            <header className="studio-card-head">
              <h3><Braces size={14} aria-hidden /> Linked XAML</h3>
              <Badge tone="muted">{view.linkedXaml.length}</Badge>
            </header>
            {view.linkedXaml.length === 0 ? (
              <div className="table-empty">No XAML file uses this type as x:Class.</div>
            ) : (
              <div className="csharp-link-list">
                {view.linkedXaml.map((entry) => (
                  <button type="button" key={entry.filePath} onClick={() => host.openXaml(entry.filePath)}>
                    <FileCode2 size={12} aria-hidden />
                    <span>{entry.relativePath}</span>
                    <code>{entry.className}</code>
                  </button>
                ))}
              </div>
            )}
            {view.linkedCodeBehind ? (
              <button type="button" className="inline-path csharp-codebehind" onClick={() => host.openXaml(view.linkedCodeBehind!)}>
                <FileCode2 size={12} aria-hidden /> Open {view.linkedCodeBehind.split(/[\\/]/).pop()}
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function PeerCard({
  title,
  icon,
  peers,
  empty,
  onOpen,
}: {
  title: string;
  icon: ReactNode;
  peers: CSharpPeer[];
  empty: string;
  onOpen: (path: string) => void;
}) {
  return (
    <section className="studio-card">
      <header className="studio-card-head">
        <h3>{icon} {title}</h3>
        <Badge tone="muted">{peers.length}</Badge>
      </header>
      {peers.length === 0 ? (
        <div className="table-empty">{empty}</div>
      ) : (
        <div className="csharp-peer-list">
          {peers.map((peer) => (
            <button type="button" key={`${peer.filePath}:${peer.typeName}:${peer.line}`} onClick={() => onOpen(peer.filePath)}>
              <span>{peer.typeName}</span>
              <code>{peer.relativePath}:{peer.line}</code>
              {peer.partial ? <Badge tone="success">partial</Badge> : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function csharpViewTitle(view: CSharpView | null): string {
  return view?.types[0]?.name ?? view?.relativePath.split(/[\\/]/).pop() ?? 'C#';
}
