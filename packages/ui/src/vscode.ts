import type { WebviewMessage } from '@ss14-studio/core';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

declare global {
  interface Window {
    /** Injected by the Rider/JCEF host before the UI bundle loads. */
    ss14StudioBridge?: VsCodeApi;
  }
}

const fallback: VsCodeApi = {
  postMessage: (message) => {
    // Browser preview: useful while developing the UI outside VS Code.
    console.debug('[ss14-studio]', message);
  },
  getState: <T,>() => undefined as T | undefined,
  setState: () => undefined,
};

let api: VsCodeApi;
if (typeof window !== 'undefined' && window.ss14StudioBridge) {
  api = window.ss14StudioBridge;
} else {
  try {
    api = acquireVsCodeApi();
  } catch {
    api = fallback;
  }
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
