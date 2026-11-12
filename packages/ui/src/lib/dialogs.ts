import type { TaggedScope } from '@ss14-studio/core';

export type DialogState =
  | { kind: 'createGraph' }
  | { kind: 'addNode' }
  | { kind: 'addEdge'; from?: string }
  | { kind: 'addStep'; from: string; to: string; edgeIndex: number }
  | {
      kind: 'addTagged';
      scope: TaggedScope;
      node?: string;
      from?: string;
      to?: string;
      edgeIndex?: number;
      stepIndex?: number;
    }
  | { kind: 'export' };

export interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
}

export interface ConfirmState extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}
