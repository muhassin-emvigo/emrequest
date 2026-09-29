import * as vscode from 'vscode';
import { Store } from '../storage';
import { Environment } from '../types';
import { pageHtml } from './webviewUtil';

export class EnvironmentPanel {
  private static panels = new Map<string, EnvironmentPanel>();
  private readonly panel: vscode.WebviewPanel;

  static open(ctx: vscode.ExtensionContext, store: Store, env: Environment) {
    const existing = EnvironmentPanel.panels.get(env.id);
    if (existing) { existing.panel.reveal(); return; }
    new EnvironmentPanel(ctx, store, env);
  }

  private constructor(ctx: vscode.ExtensionContext, private readonly store: Store, private env: Environment) {
    this.panel = vscode.window.createWebviewPanel('emrequest.environment', `Env: ${env.name}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')],
    });
    this.panel.webview.html = pageHtml(this.panel.webview, ctx.extensionUri, 'environment.js', ENV_BODY);
    EnvironmentPanel.panels.set(env.id, this);
    this.panel.onDidDispose(() => EnvironmentPanel.panels.delete(this.env.id));
    this.panel.webview.onDidReceiveMessage(async m => {
      if (m.type === 'ready') {
        const latest = this.store.getEnvironments().find(e => e.id === this.env.id) ?? this.env;
        this.panel.webview.postMessage({ type: 'load', env: latest });
      } else if (m.type === 'save') {
        this.env = { ...m.env, id: this.env.id };
        await this.store.saveEnvironment(this.env);
        this.panel.title = `Env: ${this.env.name}`;
        this.panel.webview.postMessage({ type: 'saved' });
      }
    });
  }
}

const ENV_BODY = /* html */ `
<div class="env-page">
  <div class="subbar">
    <input id="envName" class="name big" type="text" spellcheck="false">
    <span class="spacer"></span>
    <span id="savedMsg" class="muted"></span>
    <button id="save" class="primary">Save</button>
  </div>
  <p class="muted">Use a variable anywhere in a request as <code>{{name}}</code> — URL, query, headers, auth or body. Only the active environment is applied.</p>
  <div id="vars"></div>
</div>
`;
