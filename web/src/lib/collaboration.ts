import { openSocket } from "./socket";
import { drafts } from "./drafts";
import { gamesApi, type Game } from "./games";
import type { SaveSeed, SaveState } from "./autosave";
import { serializeGame } from "@bark/scripting/player";
import type { CameraPose, Transform } from "@bark/engine";

export type Member = { user: string; name: string; role: "owner" | "editor" };
export type Presence = { camera?: CameraPose; selected?: string | null; view?: string; preview?: { id: string; transform: Transform } | null };
export type Peer = Presence & { user: string; conn: string; resource: string | null };
export type ResourceLock = { resource: string; user: string; conn: string };
export type { Edit } from "./workspace-document";
import { canonical, applyEdits, edits, valueAt, scriptResource, splitScriptResource, type Edit } from "./workspace-document";
export { canonical, applyEdits, edits, valueAt, assignBlockIds, scriptResource, splitScriptResource } from "./workspace-document";
const isSource = (resource: string) => splitScriptResource(resource)[1] === "source";
export type CollaborationState = SaveState & { connected: boolean; members: Member[]; peers: Peer[]; locks: ResourceLock[]; conn: string };
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
  private presence: Presence = {};
  private lastPresence = 0;
  private lastPresenceValue = "";
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
      this.emit({ connected: false, locks: [], peers: [], status: session ? "session" : "offline", message: session ? "Sign in again or check workspace access." : "Offline — shared editing paused. Reconnecting…" });
      void this.keepDraft();
      if (!session && !this.stopped) { this.reconnect = setTimeout(() => this.start(), this.retryDelay); this.retryDelay = Math.min(this.retryDelay * 2, 10000); }
    };
    this.emit({});
  }
  private join() { if (this.joining) return; this.joining = true; this.send({ type: this.state.connected ? "sync" : "join", protocol: 3, doc: this.seed.id, have: this.rev }); }
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
      if (m.hash && await digest(next) !== m.hash) { this.joining = true; this.send({ type: "join", protocol: 3, doc: this.seed.id }); return; }
      if (this.pending && this.pending.id === m.commitId) {
        const newer = edits(this.pending.document, this.local);
        this.base = next; this.rev = m.rev; this.pending = undefined; this.replacement = false;
        this.local = applyEdits(next, newer); this.remote(this.local);
        if (this.presence.preview && m.ops.some((op: Edit) => op.resource === `entity:${this.presence.preview?.id}` || op.resource === "*")) this.publishPresence({ preview: null }, true);
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
      if (m.rev > this.rev && !this.joining) this.join();
      else this.schedule();
    } else if (m.type === "presence") {
      this.state = { ...this.state, peers: m.peers };
      this.notify(this.state);
    }
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
    try { const local = applyEdits(next, pending, true, true); this.base = next; this.rev = rev; this.local = local; this.remote(local); }
    catch (e) { this.base = next; this.rev = rev; this.fail((e as Error).message); }
  }
  private fail(message: string) { this.emit({ status: "conflict", message }); void this.keepDraft(); }
  update(game: Game, replacement = false, authoredBefore?: Game) {
    this.replacement ||= replacement;
    try {
      // The viewport can defer remote patches during a gesture. Apply only the
      // author's delta so its older rendering cannot overwrite a teammate's edit.
      this.local = authoredBefore && !replacement ? applyEdits(this.local, edits(authoredBefore, game), true, true) : structuredClone(game);
    } catch (error) {
      this.local = structuredClone(game); this.fail((error as Error).message); return;
    }
    this.emit({ status: "pending", message: "Live · Saving…" });
    this.remote(this.local); void this.keepDraft(); this.schedule();
  }
  private schedule() {
    if (!this.state.connected || this.joining || this.pending || this.packing || ["conflict", "session", "error"].includes(this.state.status)) return;
    if (this.timer) return;
    if (equal(this.base, this.local)) { this.emit({ status: "saved", message: "Live · Saved" }); return; }
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 60);
  }
  owns(resource: string) {
    const [owner] = splitScriptResource(resource);
    const parent = scriptResource(owner, "script");
    return isSource(resource)
      ? this.state.connected && !this.state.locks.some((l) => l.conn !== this.state.conn && ["*", parent].includes(l.resource))
      : this.state.locks.some((l) => l.conn === this.state.conn && (l.resource === resource || l.resource === "*"));
  }
  async acquire(resources: string[]): Promise<boolean> {
    if (!this.state.connected || ["conflict", "session", "error"].includes(this.state.status)) return false;
    if (resources.some((r) => isSource(r) && !this.owns(r))) return false;
    resources = resources.filter((r) => !isSource(r));
    if (!resources.length) return true;
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
  publishPresence(update: Presence, force = false) {
    this.presence = { ...this.presence, ...update };
    if (!this.state.connected || (!force && performance.now() - this.lastPresence < 80)) return;
    const value = canonical(this.presence);
    if (!force && value === this.lastPresenceValue && performance.now() - this.lastPresence < 2000) return;
    this.lastPresence = performance.now();
    this.lastPresenceValue = value;
    this.send({ type: "presence", ...this.presence });
  }
  endInteraction() { this.interacting = false; void this.flush(); this.releaseSoon(); }
  releaseSoon() { clearTimeout(this.releaseTimer); this.releaseTimer = setTimeout(() => { if (!this.interacting && !this.pending && equal(this.base, this.local)) this.send({ type: "unlock" }); else this.releaseSoon(); }, 1200); }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending || this.packing || this.joining) return false;
    if (equal(this.base, this.local)) return true;
    if (!this.state.connected || ["conflict", "session", "error"].includes(this.state.status)) return false;
    this.packing = true;
    try {
      const original = this.local;
      const packed = original.project.assets.every((asset) => asset.url.startsWith("data:")) ? structuredClone(original) : JSON.parse(await serializeGame(original, { baseUrl: location.href })) as Game;
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
