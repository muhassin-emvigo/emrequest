import * as vscode from 'vscode';
import { Store } from '../storage';
import { ApiRequest, Collection, Environment, HistoryItem } from '../types';

const METHOD_COLORS: Record<string, string> = {
  GET: 'charts.green', POST: 'charts.yellow', PUT: 'charts.blue', PATCH: 'charts.purple',
  DELETE: 'charts.red', HEAD: 'charts.foreground', OPTIONS: 'charts.foreground',
};

function requestIcon(method: string) {
  return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(METHOD_COLORS[method] ?? 'charts.foreground'));
}

// ---------------- Collections ----------------
export type CollectionNode =
  | { kind: 'collection'; collection: Collection }
  | { kind: 'request'; collection: Collection; request: ApiRequest };

export class CollectionsProvider implements vscode.TreeDataProvider<CollectionNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly store: Store) {
    store.onDidChange(k => { if (k === 'collections') { this._onDidChange.fire(); } });
  }

  getChildren(node?: CollectionNode): CollectionNode[] {
    if (!node) { return this.store.getCollections().map(collection => ({ kind: 'collection', collection })); }
    if (node.kind === 'collection') {
      return node.collection.requests.map(request => ({ kind: 'request', collection: node.collection, request }));
    }
    return [];
  }

  getTreeItem(node: CollectionNode): vscode.TreeItem {
    if (node.kind === 'collection') {
      const item = new vscode.TreeItem(node.collection.name, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'collection';
      item.iconPath = new vscode.ThemeIcon('folder');
      item.description = `${node.collection.requests.length}`;
      item.id = 'col-' + node.collection.id;
      return item;
    }
    const r = node.request;
    const item = new vscode.TreeItem(r.name, vscode.TreeItemCollapsibleState.None);
    item.description = r.method;
    item.tooltip = `${r.method} ${r.url}`;
    item.iconPath = requestIcon(r.method);
    item.contextValue = 'savedRequest';
    item.id = 'req-' + r.id;
    item.command = { command: 'emrequest.openRequest', title: 'Open', arguments: [r, node.collection.id] };
    return item;
  }
}

// ---------------- History ----------------
export class HistoryProvider implements vscode.TreeDataProvider<HistoryItem> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly store: Store) {
    store.onDidChange(k => { if (k === 'history') { this._onDidChange.fire(); } });
  }

  getChildren(node?: HistoryItem): HistoryItem[] { return node ? [] : this.store.getHistory(); }

  getTreeItem(h: HistoryItem): vscode.TreeItem {
    const r = h.request;
    const label = r.url.replace(/^https?:\/\//i, '') || '(no url)';
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    const status = h.status ? `${h.status}` : 'ERR';
    item.description = `${r.method} · ${status} · ${timeAgo(h.sentAt)}`;
    item.tooltip = `${r.method} ${r.url}\nStatus: ${status}\nTime: ${h.timeMs ?? '-'} ms\n${new Date(h.sentAt).toLocaleString()}`;
    item.iconPath = requestIcon(r.method);
    item.contextValue = 'historyItem';
    item.command = { command: 'emrequest.openRequest', title: 'Open', arguments: [r] };
    return item;
  }
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) { return 'just now'; }
  if (s < 3600) { return `${Math.floor(s / 60)}m ago`; }
  if (s < 86400) { return `${Math.floor(s / 3600)}h ago`; }
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------------- Environments ----------------
export class EnvironmentsProvider implements vscode.TreeDataProvider<Environment> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly store: Store) {
    store.onDidChange(k => { if (k === 'environments') { this._onDidChange.fire(); } });
  }

  getChildren(node?: Environment): Environment[] { return node ? [] : this.store.getEnvironments(); }

  getTreeItem(env: Environment): vscode.TreeItem {
    const active = this.store.getActiveEnvironmentId() === env.id;
    const item = new vscode.TreeItem(env.name, vscode.TreeItemCollapsibleState.None);
    item.description = `${env.variables.length} vars${active ? ' · active' : ''}`;
    item.iconPath = active ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green')) : new vscode.ThemeIcon('symbol-variable');
    item.contextValue = active ? 'environmentActive' : 'environment';
    item.command = { command: 'emrequest.editEnvironment', title: 'Edit', arguments: [env] };
    return item;
  }
}
