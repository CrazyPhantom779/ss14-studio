export type IdeNotificationLevel = 'info' | 'warn' | 'error' | 'success';

export interface PickFileOptions {
  title: string;
  extensions?: string[];
  directory?: boolean;
}

interface PendingRequest {
  resolve: (value: string | null) => void;
  timeout: NodeJS.Timeout;
  fallback: string | null;
}

/**
 * JSON-lines bridge to the Rider plugin. The sidecar never talks to the IDE
 * directly; it emits `type: "ide"` messages on stdout and the Kotlin host
 * performs the platform-specific action.
 */
export class IdeBridge {
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor(private readonly write: (message: unknown) => void) {}

  notify(level: IdeNotificationLevel, message: string): void {
    this.write({ type: 'ide', action: 'notify', level, message });
  }

  openPath(path: string, line?: number): void {
    this.write({ type: 'ide', action: 'openPath', path, line });
  }

  openUrl(url: string): void {
    this.write({ type: 'ide', action: 'openUrl', url });
  }

  copyText(text: string): void {
    this.write({ type: 'ide', action: 'copyText', text });
  }

  openSettings(setting?: string): void {
    this.write({ type: 'ide', action: 'openSettings', setting });
  }

  refreshFiles(paths: string[]): void {
    if (paths.length === 0) return;
    this.write({ type: 'ide', action: 'refreshFiles', paths });
  }

  revealInExplorer(path: string): void {
    this.write({ type: 'ide', action: 'revealInExplorer', path });
  }

  saveDocument(path: string): Promise<void> {
    return this.request(
      { action: 'saveDocument', path },
      15_000,
      null,
    ).then(() => undefined);
  }

  pickFile(options: PickFileOptions): Promise<string | null> {
    return this.request(
      {
        action: 'pickFile',
        title: options.title,
        extensions: options.extensions ?? [],
        directory: options.directory === true,
      },
      5 * 60_000,
      null,
    );
  }

  openScratch(
    name: string,
    content: string,
    extension: string,
  ): Promise<void> {
    return this.request(
      { action: 'openScratch', name, content, extension },
      30_000,
      null,
    ).then(() => undefined);
  }

  handleResponse(message: Record<string, unknown>): boolean {
    const command = message.command;
    if (
      command !== 'filePicked' &&
      command !== 'saved' &&
      command !== 'scratchOpened'
    ) {
      return false;
    }
    const requestId =
      typeof message.requestId === 'number' ? message.requestId : null;
    if (requestId == null) return true;
    const pending = this.pending.get(requestId);
    if (!pending) return true;
    this.pending.delete(requestId);
    clearTimeout(pending.timeout);
    const path = typeof message.path === 'string' ? message.path : pending.fallback;
    pending.resolve(path);
    return true;
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(pending.fallback);
    }
    this.pending.clear();
  }

  private request(
    payload: Record<string, unknown>,
    timeoutMs: number,
    fallback: string | null,
  ): Promise<string | null> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(fallback);
      }, timeoutMs);
      this.pending.set(requestId, { resolve, timeout, fallback });
      this.write({ type: 'ide', requestId, ...payload });
    });
  }
}
