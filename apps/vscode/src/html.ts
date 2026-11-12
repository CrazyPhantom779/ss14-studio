import * as vscode from 'vscode';

const decoder = new TextDecoder('utf-8');

const FALLBACK = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
  }
  .card {
    max-width: 520px;
    padding: 32px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 14px;
    background: color-mix(in srgb, var(--vscode-editor-background) 88%, #22d3ee 12%);
    box-shadow: 0 20px 60px rgba(0, 0, 0, .35);
  }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { margin: 0 0 12px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
  code {
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--vscode-textCodeBlock-background);
    font-family: var(--vscode-editor-font-family);
  }
</style>
</head>
<body>
  <div class="card">
    <h1>SS14 Studio</h1>
    <p>The visual editor was not built yet.</p>
    <p>Run <code>npm install</code> and <code>npm run build</code> in the repository, then reopen this panel.</p>
  </div>
</body>
</html>`;

export async function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): Promise<string> {
  const root = vscode.Uri.joinPath(extensionUri, 'media', 'webview');
  const indexPath = vscode.Uri.joinPath(root, 'index.html');

  let html: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(indexPath);
    html = decoder.decode(bytes);
  } catch {
    return FALLBACK;
  }

  html = html.replace(
    /(href|src)="(?:\.\/|\/)?assets\/([^"]+)"/g,
    (_match, attribute: string, file: string) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(root, 'assets', file));
      return `${attribute}="${uri.toString()}"`;
    },
  );

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: https:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
  ].join('; ');

  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>\n    ${meta}`);
  } else {
    html = `${meta}\n${html}`;
  }

  return html;
}
