import * as vscode from 'vscode';

export function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) { s += chars.charAt(Math.floor(Math.random() * chars.length)); }
  return s;
}

/** Shared HTML shell: strict CSP, shared stylesheet + key/value table script, and one page script. */
export function pageHtml(webview: vscode.Webview, extensionUri: vscode.Uri, script: string, body: string): string {
  const n = nonce();
  const uri = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', f));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('style.css')}">
</head>
<body>
${body}
<script nonce="${n}" src="${uri('kv.js')}"></script>
<script nonce="${n}" src="${uri(script)}"></script>
</body>
</html>`;
}
