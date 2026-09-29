import * as vscode from 'vscode';
import { ApiRequest, Collection, Environment, HistoryItem, newId } from './types';

const K_COLLECTIONS = 'emrequest.collections';
const K_HISTORY = 'emrequest.history';
const K_ENVS = 'emrequest.environments';
const K_ACTIVE_ENV = 'emrequest.activeEnvironment';

/** All persistent data lives in VS Code's globalState, so it survives restarts and is shared across workspaces. */
export class Store {
  private readonly _onDidChange = new vscode.EventEmitter<'collections' | 'history' | 'environments'>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly state: vscode.Memento) {}

  // ---------- Collections ----------
  getCollections(): Collection[] { return this.state.get<Collection[]>(K_COLLECTIONS, []); }

  private async saveCollections(c: Collection[]) {
    await this.state.update(K_COLLECTIONS, c);
    this._onDidChange.fire('collections');
  }

  async addCollection(name: string): Promise<Collection> {
    const col: Collection = { id: newId(), name, requests: [] };
    await this.saveCollections([...this.getCollections(), col]);
    return col;
  }

  async renameCollection(id: string, name: string) {
    await this.saveCollections(this.getCollections().map(c => c.id === id ? { ...c, name } : c));
  }

  async deleteCollection(id: string) {
    await this.saveCollections(this.getCollections().filter(c => c.id !== id));
  }

  /** Insert or update a request inside a collection (removes it from any other collection first). */
  async saveRequest(collectionId: string, req: ApiRequest) {
    const cols = this.getCollections().map(c => ({ ...c, requests: c.requests.filter(r => r.id !== req.id) }));
    const target = cols.find(c => c.id === collectionId);
    if (!target) { throw new Error('Collection not found'); }
    const existingIndex = this.getCollections().find(c => c.id === collectionId)?.requests.findIndex(r => r.id === req.id) ?? -1;
    if (existingIndex >= 0) { target.requests.splice(existingIndex, 0, req); } else { target.requests.push(req); }
    await this.saveCollections(cols);
  }

  async renameRequest(requestId: string, name: string) {
    await this.saveCollections(this.getCollections().map(c => ({
      ...c, requests: c.requests.map(r => r.id === requestId ? { ...r, name } : r),
    })));
  }

  async deleteRequest(requestId: string) {
    await this.saveCollections(this.getCollections().map(c => ({ ...c, requests: c.requests.filter(r => r.id !== requestId) })));
  }

  findRequest(requestId: string): { collection: Collection; request: ApiRequest } | undefined {
    for (const c of this.getCollections()) {
      const r = c.requests.find(x => x.id === requestId);
      if (r) { return { collection: c, request: r }; }
    }
    return undefined;
  }

  // ---------- History ----------
  getHistory(): HistoryItem[] { return this.state.get<HistoryItem[]>(K_HISTORY, []); }

  async addHistory(item: HistoryItem, limit: number) {
    const list = [item, ...this.getHistory()].slice(0, Math.max(1, limit));
    await this.state.update(K_HISTORY, list);
    this._onDidChange.fire('history');
  }

  async deleteHistory(id: string) {
    await this.state.update(K_HISTORY, this.getHistory().filter(h => h.id !== id));
    this._onDidChange.fire('history');
  }

  async clearHistory() {
    await this.state.update(K_HISTORY, []);
    this._onDidChange.fire('history');
  }

  // ---------- Environments ----------
  getEnvironments(): Environment[] { return this.state.get<Environment[]>(K_ENVS, []); }

  getActiveEnvironmentId(): string | undefined { return this.state.get<string>(K_ACTIVE_ENV); }

  getActiveEnvironment(): Environment | undefined {
    const id = this.getActiveEnvironmentId();
    return this.getEnvironments().find(e => e.id === id);
  }

  async setActiveEnvironment(id: string | undefined) {
    await this.state.update(K_ACTIVE_ENV, id);
    this._onDidChange.fire('environments');
  }

  async saveEnvironment(env: Environment) {
    const list = this.getEnvironments();
    const i = list.findIndex(e => e.id === env.id);
    if (i >= 0) { list[i] = env; } else { list.push(env); }
    await this.state.update(K_ENVS, list);
    this._onDidChange.fire('environments');
  }

  async deleteEnvironment(id: string) {
    await this.state.update(K_ENVS, this.getEnvironments().filter(e => e.id !== id));
    if (this.getActiveEnvironmentId() === id) { await this.state.update(K_ACTIVE_ENV, undefined); }
    this._onDidChange.fire('environments');
  }
}
