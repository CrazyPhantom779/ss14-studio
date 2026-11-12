import type { WebviewMessage } from '@ss14-studio/core';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const fallback: VsCodeApi = {
  postMessage: (message) => {
    // Browser preview: useful while developing the UI outside VS Code.
    console.debug('[ss14-studio]', message);
  },
  getState: <T,>() => undefined as T | undefined,
  setState: () => undefined,
};

let api: VsCodeApi;
try {
  api = acquireVsCodeApi();
} catch {
  api = fallback;
}

export const vscode = api;

export function post(message: WebviewMessage): void {
  api.postMessage(message);
}

export interface PersistedUiState {
  recent?: string[];
  sidebarOpen?: boolean;
  inspectorOpen?: boolean;
}

export function readUiState(): PersistedUiState {
  return api.getState<PersistedUiState>() ?? {};
}

export function writeUiState(state: PersistedUiState): void {
  api.setState(state);
}
