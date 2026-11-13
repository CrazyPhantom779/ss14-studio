import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Columns2,
  Copy,
  GitCompareArrows,
  Rows3,
  TriangleAlert,
} from 'lucide-react';
import type { StudioHost } from '../lib/host';
import { Badge, Button, IconButton } from './ui';

export function DiffView({ host, onBack }: { host: StudioHost; onBack: () => void }) {
  const diff = host.diff;
  const [mode, setMode] = useState<'unified' | 'split'>('unified');

  if (!diff) {
    return (
      <div className="studio-detail-empty">
        <span className="detail-empty-icon"><GitCompareArrows size={30} aria-hidden /></span>
        <h2>Nothing to compare yet</h2>
        <p>Format or clean a prototype, RSI or XAML file to see a before/after diff here.</p>
        <Button icon={ArrowLeft} onClick={onBack}>Go back</Button>
      </div>
    );
  }

  return (
    <div className="diff-view">
      <header className="studio-page-head">
        <div>
          <div className="prototype-eyebrow">
            <Badge tone="accent">Diff</Badge>
            <code>{diff.oldLabel} → {diff.newLabel}</code>
            {diff.conflicts ? <Badge tone="danger">conflict markers</Badge> : null}
          </div>
          <h1>{diff.title}</h1>
          <p className="studio-page-sub">
            <span className="diff-add">+{diff.added}</span> added · <span className="diff-remove">−{diff.removed}</span> removed ·{' '}
            {diff.identical ? 'no changes' : `${diff.hunks.length} hunk${diff.hunks.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="studio-page-actions">
          <Button icon={ArrowLeft} size="sm" onClick={onBack}>Back</Button>
          <div className="segmented">
            <button type="button" className={mode === 'unified' ? 'active' : ''} onClick={() => setMode('unified')}>
              <Rows3 size={12} aria-hidden /> Unified
            </button>
            <button type="button" className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>
              <Columns2 size={12} aria-hidden /> Split
            </button>
          </div>
          {diff.newText ? (
            <IconButton icon={Copy} label="Copy the new text" onClick={() => host.copyText(diff.newText!)} />
          ) : null}
        </div>
      </header>

      {diff.conflicts ? (
        <div className="diff-conflict-banner">
          <TriangleAlert size={15} aria-hidden />
          <div>
            <strong>Merge conflict markers detected</strong>
            <span>
              Resolve <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>, <code>=======</code> and <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> in the
              source file, then reopen this comparison. SS14 Studio never applies a merge for you.
            </span>
          </div>
        </div>
      ) : null}

      {diff.identical ? (
        <div className="diff-identical">
          <Check size={22} aria-hidden />
          <strong>The two versions are identical.</strong>
          <span>There is nothing to merge.</span>
        </div>
      ) : (
        <div className={`diff-body ${mode}`}>
          {diff.hunks.map((hunk, hunkIndex) => (
            <section className="diff-hunk" key={hunkIndex}>
              <header>
                <span>@@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@</span>
              </header>
              {mode === 'unified' ? (
                <div className="diff-lines">
                  {hunk.lines.map((line, index) => (
                    <div className={`diff-line ${line.kind}`} key={index}>
                      <span className="diff-gutter">{line.oldLine ?? ''}</span>
                      <span className="diff-gutter">{line.newLine ?? ''}</span>
                      <span className="diff-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
                      <code>{line.text || ' '}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="diff-split">
                  <div className="diff-split-col">
                    <div className="diff-split-head">{diff.oldLabel}</div>
                    {hunk.lines.map((line, index) => (
                      <div className={`diff-line ${line.kind === 'add' ? 'blank' : line.kind}`} key={index}>
                        <span className="diff-gutter">{line.oldLine ?? ''}</span>
                        <code>{line.kind === 'add' ? '' : line.text || ' '}</code>
                      </div>
                    ))}
                  </div>
                  <div className="diff-split-col">
                    <div className="diff-split-head">{diff.newLabel}</div>
                    {hunk.lines.map((line, index) => (
                      <div className={`diff-line ${line.kind === 'remove' ? 'blank' : line.kind}`} key={index}>
                        <span className="diff-gutter">{line.newLine ?? ''}</span>
                        <code>{line.kind === 'remove' ? '' : line.text || ' '}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
