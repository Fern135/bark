import { openSocket } from "./socket";
import { drafts } from "./drafts";
import { gamesApi, type Game } from "./games";
import type { SaveSeed, SaveState } from "./autosave";
import { serializeGame } from "@bark/scripting/player";

export type Member = { user: string; name: string; role: "owner" | "editor" };
export type Peer = { user: string; conn: string; resource: string | null };
export type ResourceLock = { resource: string; user: string; conn: string };
export type Edit = { op: "set"; resource: string; before: unknown; value: unknown };
export type CollaborationState = SaveState & { connected: boolean; members: Member[]; peers: Peer[]; locks: ResourceLock[]; conn: string };
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
async function digest(value: unknown): Promise<string> {
  const normalize = (v: unknown): unknown => {
    if (typeof v === "number") { const buffer = new ArrayBuffer(8); new DataView(buffer).setFloat64(0, v || 0); return ["#number", Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("")]; }
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, normalize(val)]));
    return v;
  };
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(normalize(value))))), (b) => b.toString(16).padStart(2, "0")).join("");
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
type Root = { id: string; [key: string]: unknown };
function roots(game: Game): Root[] {
  return game.script.language === "blocks" ? ((game.script.workspace.blocks as { blocks?: Root[] })?.blocks ?? []) : [];
}
export function valueAt(game: Game, resource: string): unknown {
  if (resource === "*") return game;
  if (resource === "script") return game.script;
  if (resource === "variables") return game.script.language === "blocks" ? game.script.workspace.variables ?? [] : [];
  const [kind, ...parts] = resource.split(":"); const key = parts.join(":");
  if (kind === "entity") return game.project.entities.find((e) => e.id === key) ?? null;
  if (kind === "block") return roots(game).find((e) => e.id === key) ?? null;
  return (game.project as unknown as Record<string, unknown>)[key] ?? null;
}
export function edits(before: Game, after: Game): Edit[] {
  const result: Edit[] = [];
  const add = (resource: string) => { const a = valueAt(before, resource), b = valueAt(after, resource); if (!equal(a, b)) result.push({ op: "set", resource, before: a, value: b }); };
  for (const id of new Set([...before.project.entities, ...after.project.entities].map((e) => e.id))) add(`entity:${id}`);
  for (const key of ["name", "settings", "cameras", "input", "properties", "assets", "materials", "prefabs"]) add(`section:${key}`);
  if (before.script.language !== "blocks" || after.script.language !== "blocks") add("script");
  else {
    for (const id of new Set([...roots(before), ...roots(after)].map((b) => b.id))) add(`block:${id}`);
    add("variables");
  }
  return result;
}
export function applyEdits(document: Game, ops: Edit[], check = true): Game {
  let game = structuredClone(document);
  for (const op of ops) {
    if (check && !equal(valueAt(game, op.resource), op.before)) throw new Error("This item changed while you were editing. Reload or save your work as a copy.");
    const value = structuredClone(op.value);
    if (op.resource === "*") game = value as Game;
    else if (op.resource === "script") game.script = value as Game["script"];
    else if (op.resource === "variables" && game.script.language === "blocks") game.script.workspace.variables = value;
    else if (op.resource.startsWith("section:")) (game.project as unknown as Record<string, unknown>)[op.resource.slice(8)] = value;
    else {
      const items = op.resource.startsWith("entity:") ? game.project.entities : roots(game);
      const key = op.resource.slice(op.resource.indexOf(":") + 1);
      const index = items.findIndex((i) => i.id === key);
      if (index >= 0) { if (value === null) items.splice(index, 1); else items.splice(index, 1, value as never); }
      else if (value !== null) items.push(value as never);
    }
  }
  return game;
}

export function assignBlockIds(game: Game): Game {
  for (const workspace of [game.script.language === "blocks" ? game.script.workspace : undefined, game.script.language === "python" ? game.script.blocksBackup : undefined]) {
    if (!workspace) continue;
    const seen = new Set<string>();
    const block = (node: Record<string, unknown>) => {
      if (typeof node.id !== "string" || !node.id || seen.has(node.id)) node.id = crypto.randomUUID();
      seen.add(node.id as string);
      const connections = [...Object.values((node.inputs ?? {}) as Record<string, Record<string, unknown>>), (node.next ?? {}) as Record<string, unknown>];
      for (const connection of connections) for (const key of ["block", "shadow"]) if (connection[key]) block(connection[key] as Record<string, unknown>);
    };
    for (const root of ((workspace.blocks as { blocks?: Record<string, unknown>[] })?.blocks ?? [])) block(root);
  }
  return game;
}

export class Collaboration {
  state: CollaborationState = { status: "pending", message: "Connecting to workspace…", localError: "", dirty: false, connected: false, members: [], peers: [], locks: [], conn: "" };
  private socket?: WebSocket;
  private base: Game;
  private local: Game;
  private rev: number;
  private pending?: { id: string; ops: Edit[]; document: Game };
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private waiters = new Map<number, (ok: boolean) => void>();
  private nonce = 0;
  private disposed = false;
  private stopped = false;
  private joining = false;
  private packing = false;
  private localWrites: Promise<void> = Promise.resolve();
  private incoming: Promise<void> = Promise.resolve();
  private retryDelay = 500;
  private interacting = false;
  private replacement = false;
  constructor(private seed: SaveSeed, document: Game, private notify: (state: CollaborationState) => void, private remote: (game: Game) => void) {
    this.base = structuredClone(seed.collabBase ?? document); this.local = structuredClone(document); this.rev = seed.revision ?? 0;
    this.state.dirty = !equal(this.base, this.local);
    if (seed.recoveryConflict) { this.state.status = "conflict"; this.state.message = "This draft predates live editing. Reload the workspace or save your local work as a copy."; }
  }
  private emit(update: Partial<CollaborationState>) { this.state = { ...this.state, ...update, dirty: !equal(this.base, this.local) || !!this.pending }; if (!this.disposed) this.notify(this.state); }
  private send(message: object) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  start() {
    if (this.stopped) return;
    this.disposed = false;
    if (!navigator.onLine) { this.emit({ connected: false, locks: [], status: "offline", message: "Offline — shared editing paused." }); return; }
    const socket = openSocket(); this.socket = socket;
    socket.onmessage = (event) => { if (socket === this.socket) this.incoming = this.incoming.then(() => this.receive(JSON.parse(event.data))).catch((e) => this.fail(String(e))); };
    socket.onclose = (event) => {
      if (this.disposed || socket !== this.socket) return;
      clearInterval(this.heartbeat); this.waiters.forEach((resolve) => resolve(false)); this.waiters.clear();
      this.joining = false;
      if (this.stopped) return;
      const session = event.code === 1008;
      this.emit({ connected: false, locks: [], status: session ? "session" : "offline", message: session ? "Sign in again or check workspace access." : "Offline — shared editing paused. Reconnecting…" });
      void this.keepDraft();
      if (!session && !this.stopped) { this.reconnect = setTimeout(() => this.start(), this.retryDelay); this.retryDelay = Math.min(this.retryDelay * 2, 10000); }
    };
    this.emit({});
  }
  private join() { if (this.joining) return; this.joining = true; this.emit({ connected: false }); this.send({ type: "join", protocol: 2, doc: this.seed.id, have: this.rev }); }
  // Payloads are checked by the server and applied serially here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async receive(m: any) {
    if (this.disposed || this.stopped) return;
    if (m.type === "ready") {
      if (m.user !== this.seed.owner) { this.stopped = true; this.socket?.close(); this.emit({ connected: false, status: "session", message: "Sign in to the original account." }); return; }
      this.emit({ conn: m.conn }); this.join();
      this.heartbeat = setInterval(() => this.send({ type: "heartbeat" }), 5000);
    } else if (m.type === "snapshot") {
      this.rebase(m.document, m.rev); this.pending = undefined;
      this.emit({ members: m.members, locks: m.locks });
    } else if (m.type === "patch") {
      if (m.rev <= this.rev) return;
      if (m.rev !== this.rev + 1) { this.joining = false; this.join(); return; }
      const next = applyEdits(this.base, m.ops);
      if (m.hash && await digest(next) !== m.hash) { this.joining = true; this.send({ type: "join", protocol: 2, doc: this.seed.id }); return; }
      if (this.pending && this.pending.id === m.commitId) {
        const newer = edits(this.pending.document, this.local);
        this.base = next; this.rev = m.rev; this.pending = undefined; this.replacement = false;
        this.local = applyEdits(next, newer); this.remote(this.local);
      } else this.rebase(next, m.rev);
      await this.keepDraft(); this.emit({}); this.schedule();
    } else if (m.type === "joined") {
      this.joining = false;
      if (m.rev > this.rev) { this.join(); return; }
      // Any durable pending commit was included in replay. Recompute unsent intent
      // against the reconciled document and acquire this new connection's leases.
      this.pending = undefined;
      this.retryDelay = 500;
      this.emit({ connected: true, members: m.members, locks: m.locks, status: this.state.status === "conflict" ? "conflict" : "saved", message: this.state.status === "conflict" ? this.state.message : "Live · Saved" });
      this.schedule();
    } else if (m.type === "state") {
      this.emit({ locks: m.locks, members: m.members });
      if (m.rev !== this.rev && !this.joining) this.join();
      else this.schedule();
    } else if (m.type === "presence") this.emit({ peers: m.peers });
    else if (m.type === "locks" || m.type === "locked") {
      this.emit({ locks: m.locks });
      if (m.type === "locked") { this.waiters.get(m.nonce)?.(true); this.waiters.delete(m.nonce); }
    } else if (m.type === "error") {
      this.waiters.get(m.nonce)?.(false); this.waiters.delete(m.nonce);
      if (m.code === "REV_MISMATCH") { this.pending = undefined; this.joining = false; this.join(); }
      else if (m.code === "FORBIDDEN") { this.stopped = true; this.socket?.close(); this.emit({ connected: false, status: "session", message: m.message }); }
      else if (m.code === "LOCK_HELD") { if (m.nonce === undefined) this.pending = undefined; this.emit({ message: m.message }); }
      else if (m.code === "UNAVAILABLE") { this.socket?.close(); }
      else this.fail(m.message);
    }
  }
  private rebase(next: Game, rev: number) {
    const pending = edits(this.base, this.local).filter((op) => !equal(valueAt(next, op.resource), op.value));
    try { const local = applyEdits(next, pending); this.base = next; this.rev = rev; this.local = local; this.remote(local); }
    catch (e) { this.base = next; this.rev = rev; this.fail((e as Error).message); }
  }
  private fail(message: string) { this.emit({ status: "conflict", message }); void this.keepDraft(); }
  update(game: Game, replacement = false, authoredBefore?: Game) {
    this.replacement ||= replacement;
    try {
      // The viewport can defer remote patches during a gesture. Apply only the
      // author's delta so its older rendering cannot overwrite a teammate's edit.
      this.local = authoredBefore && !replacement ? applyEdits(this.local, edits(authoredBefore, game)) : structuredClone(game);
    } catch (error) {
      this.local = structuredClone(game); this.fail((error as Error).message); return;
    }
    this.emit({ status: "pending", message: "Live · Saving…" });
    this.remote(this.local); void this.keepDraft(); this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.state.connected || this.pending || this.packing || ["conflict", "session", "error"].includes(this.state.status)) return;
    if (equal(this.base, this.local)) { this.emit({ status: "saved", message: "Live · Saved" }); return; }
    this.timer = setTimeout(() => { void this.flush(); }, 100);
  }
  owns(resource: string) { return this.state.locks.some((l) => l.conn === this.state.conn && (l.resource === resource || l.resource === "*")); }
  async acquire(resources: string[]): Promise<boolean> {
    if (!this.state.connected || ["conflict", "session", "error"].includes(this.state.status)) return false;
    clearTimeout(this.releaseTimer);
    if (resources.every((r) => this.owns(r))) { this.releaseSoon(); return true; }
    const nonce = ++this.nonce;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { this.waiters.delete(nonce); resolve(false); }, 5000);
      this.waiters.set(nonce, (ok) => { clearTimeout(timeout); if (ok) { this.releaseSoon(); this.emit({ message: this.state.dirty ? "Live · Saving…" : "Live · Saved" }); } resolve(ok); });
      this.send({ type: "lock", resources, nonce });
    });
  }
  beginInteraction() { this.interacting = true; }
  endInteraction() { this.interacting = false; void this.flush(); this.releaseSoon(); }
  releaseSoon() { clearTimeout(this.releaseTimer); this.releaseTimer = setTimeout(() => { if (!this.interacting && !this.pending && equal(this.base, this.local)) this.send({ type: "unlock" }); else this.releaseSoon(); }, 1200); }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.pending || this.packing) return false;
    if (equal(this.base, this.local)) return true;
    if (!this.state.connected || ["conflict", "session", "error"].includes(this.state.status)) return false;
    this.packing = true;
    try {
      const original = this.local;
      const packed = JSON.parse(await serializeGame(original, { baseUrl: location.href })) as Game;
      // Packing resolves portable assets; preserve edits made while it was in flight.
      this.local = applyEdits(packed, edits(original, this.local));
      const portableAssets = canonical(packed.project.assets);
      if (canonical(this.local.project.assets) !== portableAssets) {
        this.timer = setTimeout(() => { void this.flush(); }, 100); return false;
      }
      const ops: Edit[] = this.replacement ? [{ op: "set", resource: "*", before: this.base, value: this.local }] : edits(this.base, this.local);
      if (!ops.length) return true;
      if (ops.length > 64 || JSON.stringify(packed).length > 10 * 1024 * 1024) throw new Error("This edit is too large. Export JSON to preserve your work.");
      if (!(await this.acquire(ops.map((op) => op.resource)))) return false;
      // Remote patches may have arrived while waiting for locks. Recompute from current truth.
      const latest: Edit[] = this.replacement ? [{ op: "set", resource: "*", before: this.base, value: this.local }] : edits(this.base, this.local);
      if (!latest.length) { this.emit({ status: "saved", message: "Live · Saved" }); return true; }
      if (!this.state.connected || canonical(this.local.project.assets) !== portableAssets || !latest.every((op) => this.owns(op.resource))) {
        this.timer = setTimeout(() => { void this.flush(); }, 100); return false;
      }
      this.pending = { id: crypto.randomUUID(), ops: latest, document: structuredClone(this.local) };
      this.send({ type: "commit", base: this.rev, commitId: this.pending.id, ops: latest });
      this.emit({ status: "saving", message: "Live · Saving…" }); this.releaseSoon();
      return false;
    } catch (e) { this.emit({ status: "error", message: (e as Error).message }); return false; }
    finally { this.packing = false; }
  }
  async settled() { await this.flush(); for (let i = 0; i < 50 && this.state.connected && this.state.dirty && !["conflict", "error", "session"].includes(this.state.status); i++) await new Promise((r) => setTimeout(r, 100)); return !this.state.dirty; }
  async keepDraft() {
    const draft = { ...this.seed, revision: this.rev, collabBase: structuredClone(this.base), document: structuredClone(this.local), dirty: !equal(this.base, this.local) || !!this.pending, updatedAt: Date.now() };
    this.localWrites = this.localWrites.catch(() => {}).then(() => drafts.put(draft));
    try { await this.localWrites; return true; } catch { this.emit({ localError: "Local recovery is unavailable. Export JSON to keep your work." }); return false; }
  }
  async copy() { const game = JSON.parse(await serializeGame(this.local, { baseUrl: location.href })) as Game; return gamesApi.create(crypto.randomUUID(), game, this.seed.owner!); }
  async reload() { this.local = structuredClone(this.base); this.pending = undefined; this.remote(this.local); this.emit({ status: "saved", message: "Live · Saved" }); await this.keepDraft(); }
  retry() { if (this.state.connected) { this.emit({ status: "pending" }); this.schedule(); } else { this.stopped = false; this.socket?.close(); clearTimeout(this.reconnect); this.start(); } }
  suspend() { this.stopped = true; this.emit({ connected: false, locks: [], status: "session", message: "Sign in to the original account to continue editing." }); this.socket?.close(); void this.keepDraft(); }
  offline() { this.emit({ connected: false, locks: [], status: "offline", message: "Offline — shared editing paused." }); this.socket?.close(); void this.keepDraft(); }
  dispose() { this.disposed = true; void this.keepDraft(); clearInterval(this.heartbeat); clearTimeout(this.timer); clearTimeout(this.reconnect); clearTimeout(this.releaseTimer); this.waiters.forEach((r) => r(false)); this.waiters.clear(); this.socket?.close(); }
}
