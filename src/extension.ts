import * as vscode from 'vscode';
import { Store } from './storage';
import { ApiRequest, blankRequest, Environment, HistoryItem, newId } from './types';
import { CollectionNode, CollectionsProvider, EnvironmentsProvider, HistoryProvider } from './views/trees';
import { RequestPanel } from './views/requestPanel';
import { EnvironmentPanel } from './views/environmentPanel';
import { parseCurl } from './core/curl';

export function activate(ctx: vscode.ExtensionContext) {
  const store = new Store(ctx.globalState);

  const collectionsView = vscode.window.createTreeView('emrequest.collections', { treeDataProvider: new CollectionsProvider(store) });
  // Commands fired by F2 get no argument, so fall back to the selected item
  const selected = (node?: CollectionNode) => node ?? collectionsView.selection[0];

  const validateName = (v: string) => v.trim() ? undefined : 'Name cannot be empty';

  ctx.subscriptions.push(
    collectionsView,
    vscode.window.registerTreeDataProvider('emrequest.history', new HistoryProvider(store)),
    vscode.window.registerTreeDataProvider('emrequest.environments', new EnvironmentsProvider(store)),
  );

  store.onDidChange(k => { if (k === 'environments') { RequestPanel.refreshEnvironments(store); } });

  const cmd = (id: string, fn: (...args: any[]) => any) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // ---- Requests ----
  cmd('emrequest.newRequest', (node?: CollectionNode) => {
    const colId = node?.kind === 'collection' ? node.collection.id : undefined;
    RequestPanel.open(ctx, store, blankRequest(), colId);
  });

  cmd('emrequest.openRequest', (req: ApiRequest, collectionId?: string) => {
    if (!collectionId) {
      // from History: open an unsaved copy so edits don't overwrite the history entry
      RequestPanel.open(ctx, store, { ...req, id: newId() });
    } else {
      RequestPanel.open(ctx, store, req, collectionId);
    }
  });

  cmd('emrequest.renameRequest', async (arg?: CollectionNode) => {
    const node = selected(arg);
    if (node?.kind !== 'request') { return; }
    const name = await vscode.window.showInputBox({
      prompt: `Rename request in "${node.collection.name}"`,
      value: node.request.name,
      valueSelection: [0, node.request.name.length],
      validateInput: validateName,
    });
    if (!name || name.trim() === node.request.name) { return; }
    await store.renameRequest(node.request.id, name.trim());
    RequestPanel.notifyRenamed(node.request.id, name.trim());
  });

  cmd('emrequest.deleteRequest', async (arg?: CollectionNode) => {
    const node = selected(arg);
    if (node?.kind !== 'request') { return; }
    const ok = await vscode.window.showWarningMessage(`Delete "${node.request.name}"?`, { modal: true }, 'Delete');
    if (ok === 'Delete') { await store.deleteRequest(node.request.id); }
  });

  cmd('emrequest.importCurl', async () => {
    const clip = (await vscode.env.clipboard.readText()).trim();
    const value = await vscode.window.showInputBox({
      prompt: 'Paste a cURL command',
      placeHolder: `curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{"name":"Ada"}'`,
      value: clip.toLowerCase().startsWith('curl') ? clip : '',
      ignoreFocusOut: true,
    });
    if (!value) { return; }
    try {
      RequestPanel.open(ctx, store, parseCurl(value));
    } catch (e: any) {
      vscode.window.showErrorMessage(`Could not import cURL: ${e.message}`);
    }
  });

  // ---- Collections ----
  cmd('emrequest.newCollection', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'Collection name', placeHolder: 'e.g. Payments API' });
    if (name) { await store.addCollection(name); }
  });

  cmd('emrequest.renameCollection', async (arg?: CollectionNode) => {
    const node = selected(arg);
    if (node?.kind !== 'collection') { return; }
    const name = await vscode.window.showInputBox({
      prompt: 'Rename collection', value: node.collection.name, validateInput: validateName,
    });
    if (name && name.trim() !== node.collection.name) { await store.renameCollection(node.collection.id, name.trim()); }
  });

  cmd('emrequest.deleteCollection', async (arg?: CollectionNode) => {
    const node = selected(arg);
    if (node?.kind !== 'collection') { return; }
    const ok = await vscode.window.showWarningMessage(
      `Delete collection "${node.collection.name}" and its ${node.collection.requests.length} request(s)?`, { modal: true }, 'Delete');
    if (ok === 'Delete') { await store.deleteCollection(node.collection.id); }
  });

  // ---- History ----
  cmd('emrequest.clearHistory', async () => {
    const ok = await vscode.window.showWarningMessage('Clear all request history?', { modal: true }, 'Clear');
    if (ok === 'Clear') { await store.clearHistory(); }
  });
  cmd('emrequest.deleteHistoryItem', (h: HistoryItem) => h && store.deleteHistory(h.id));

  // ---- Environments ----
  cmd('emrequest.newEnvironment', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'Environment name', placeHolder: 'e.g. Local, Staging, Production' });
    if (!name) { return; }
    const env: Environment = { id: newId(), name, variables: [{ key: 'baseUrl', value: 'http://localhost:3000', enabled: true }] };
    await store.saveEnvironment(env);
    if (!store.getActiveEnvironmentId()) { await store.setActiveEnvironment(env.id); }
    EnvironmentPanel.open(ctx, store, env);
  });
  cmd('emrequest.editEnvironment', (env: Environment) => env && EnvironmentPanel.open(ctx, store, env));
  cmd('emrequest.activateEnvironment', (env: Environment) => env && store.setActiveEnvironment(env.id));
  cmd('emrequest.deactivateEnvironment', () => store.setActiveEnvironment(undefined));
  cmd('emrequest.deleteEnvironment', async (env: Environment) => {
    if (!env) { return; }
    const ok = await vscode.window.showWarningMessage(`Delete environment "${env.name}"?`, { modal: true }, 'Delete');
    if (ok === 'Delete') { await store.deleteEnvironment(env.id); }
  });
}

export function deactivate() { /* nothing to clean up */ }
