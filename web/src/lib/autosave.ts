import axios from "axios";
import { serializeGame } from "@bark/scripting/player";
import { errorMessage } from "./accounts";
import { drafts, type Draft } from "./drafts";
import { gamesApi, type Game, type SavedGame } from "./games";

export type SaveState = { status: "guest" | "pending" | "saving" | "saved" | "offline" | "error" | "conflict" | "session"; message: string; localError: string; dirty: boolean };
export type SaveSeed = { id: string; owner: string | null; revision: number | null; dirty: boolean; collaboration?: boolean; role?: "owner" | "editor"; collabBase?: Game; recoveryConflict?: boolean; publication?: { is_public: boolean } };
// Compare JSON values, not key order: Postgres JSONB reorders objects.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export class Autosave {
  private document: Game;
  private seed: SaveSeed;
  private generation = 0;
  private acknowledged = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private localTimer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<boolean>;
  private localWrites: Promise<void> = Promise.resolve();
  private retries = 0;
  private retryAt = 0;
  private disposed = false;
  private user: string | null;
  private creation?: { document: Game; generation: number };
  private state: SaveState;
  constructor(seed: SaveSeed, document: Game, private notify: (state: SaveState) => void) {
    this.seed = { ...seed }; this.document = document; this.user = seed.owner;
    this.generation = seed.dirty ? 1 : 0;
    this.state = { status: seed.dirty ? seed.owner ? "pending" : "guest" : "saved", message: seed.dirty ? seed.owner ? "Waiting to save…" : "Sign in to save to My Games" : seed.revision === null ? "Ready to make your own" : "Saved", localError: "", dirty: seed.dirty };
  }
  start() { this.emit({}); if (this.state.dirty) { void this.persist(); this.schedule(); } }
  private emit(update: Partial<SaveState>) { this.state = { ...this.state, ...update, dirty: this.generation !== this.acknowledged }; if (!this.disposed) this.notify(this.state); }
  private schedule(delay = 1500) {
    clearTimeout(this.timer);
    if (this.disposed || !this.state.dirty || !this.user || this.user !== this.seed.owner || ["conflict", "session", "error"].includes(this.state.status)) return;
    this.timer = setTimeout(() => { void this.flush(); }, Math.max(delay, this.retryAt - Date.now()));
  }
  setUser(user: string | null) {
    this.user = user;
    if (this.seed.owner && user !== this.seed.owner) { clearTimeout(this.timer); this.emit({ status: "session", message: "Sign in to the original account to resume saving." }); }
    else if (user && this.seed.owner === user && this.state.status === "session") { this.emit({ status: this.state.dirty ? "pending" : "saved", message: this.state.dirty ? "Waiting to save…" : "Saved" }); this.schedule(); }
    // Guest drafts are adopted only by the explicit login return flow in the loader.
  }
  update(document: Game) {
    this.document = document; this.generation++;
    if (!["conflict", "session", "error"].includes(this.state.status)) this.emit({ status: this.seed.owner ? "pending" : "guest", message: this.seed.owner ? "Waiting to save…" : "Sign in to save to My Games" });
    else this.emit({});
    clearTimeout(this.localTimer);
    this.localTimer = setTimeout(() => { void this.persist(); }, 150);
    this.schedule();
  }
  private persist(): Promise<void> {
    const draft: Draft = { ...this.seed, document: structuredClone(this.document), dirty: this.generation !== this.acknowledged, updatedAt: Date.now() };
    this.localWrites = this.localWrites.catch(() => {}).then(() => drafts.put(draft));
    return this.localWrites.then(() => { this.emit({ localError: "" }); }, () => { this.emit({ localError: "Local recovery is unavailable. Export JSON to keep a backup." }); });
  }
  async keepDraft(): Promise<boolean> {
    clearTimeout(this.localTimer);
    await this.persist();
    return !this.state.localError;
  }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.inFlight) { await this.inFlight; return this.state.dirty && !["conflict", "error", "session", "offline"].includes(this.state.status) ? this.flush() : !this.state.dirty; }
    if (!this.state.dirty) return true;
    if (!this.user || this.user !== this.seed.owner || ["conflict", "session", "error"].includes(this.state.status)) return false;
    if (!navigator.onLine) { this.emit({ status: "offline", message: "Offline — changes kept on this device" }); return false; }
    if (Date.now() < this.retryAt) { this.schedule(); return false; }
    this.inFlight = this.save();
    let result: boolean;
    try { result = await this.inFlight; }
    finally { this.inFlight = undefined; }
    return !result && this.state.status === "pending" ? this.flush() : result;
  }
  private async save(): Promise<boolean> {
    const generation = this.generation;
    const document = this.document;
    this.emit({ status: "saving", message: "Saving…" });
    try {
      const packed = this.creation?.document ?? JSON.parse(await serializeGame(document, { baseUrl: location.href })) as Game;
      packed.project.name = packed.project.name.trim();
      if (new TextEncoder().encode(JSON.stringify(packed)).byteLength > 10 * 1024 * 1024 - 1024) throw new Error("This world is too large to save (10 MB maximum). Export JSON to keep a copy.");
      if (this.disposed || this.user !== this.seed.owner) return false;
      let saved: SavedGame;
      let savedGeneration = generation;
      if (this.seed.revision === null) {
        this.creation ??= { document: packed, generation };
        saved = await gamesApi.create(this.seed.id, this.creation.document, this.seed.owner!);
        savedGeneration = this.creation.generation;
        if (canonical(saved.document) !== canonical(this.creation.document)) {
          this.seed.revision = saved.revision;
          this.emit({ status: "conflict", message: "This game changed in another tab. Reload it or save your work as a copy." });
          await this.persist(); return false;
        }
        this.creation = undefined;
        if (!this.disposed) window.history.replaceState(null, "", `/editor?id=${this.seed.id}`);
      } else saved = await gamesApi.save(this.seed.id, this.seed.revision, packed, this.seed.owner!);
      this.seed.revision = saved.revision; this.acknowledged = savedGeneration; this.retries = 0; this.retryAt = 0;
      if (this.disposed) return false;
      this.emit(this.user !== this.seed.owner ? { status: "session", message: "Sign in to the original account to resume saving." } : { status: this.generation === savedGeneration ? "saved" : "pending", message: this.generation === savedGeneration ? "Saved" : "Waiting to save…" });
      await this.persist(); this.schedule();
      return !this.state.dirty;
    } catch (error) {
      if (this.disposed) return false;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 412) this.emit({ status: "conflict", message: "This game changed in another tab. Reload it or save your work as a copy." });
      else if (status === 401) this.emit({ status: "session", message: "Your session expired. Sign in to resume saving." });
      else if (axios.isAxiosError(error) && (!status || status >= 500 || status === 429)) {
        const retryAfter = error.response?.headers["retry-after"];
        const seconds = Number(retryAfter);
        const headerDelay = retryAfter ? Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
        const delay = Math.max(Number.isFinite(headerDelay) ? headerDelay : 0, Math.min(30_000, 2000 * 2 ** this.retries++));
        this.retryAt = Date.now() + delay;
        this.emit({ status: "offline", message: navigator.onLine ? "Save failed — retrying shortly" : "Offline — changes kept on this device" }); this.schedule(delay);
      } else this.emit({ status: "error", message: errorMessage(error) });
      await this.persist(); return false;
    }
  }
  retry(automatic = false) {
    if (automatic && this.state.status !== "offline") return;
    if (this.state.status === "conflict" || this.disposed) return;
    if (!this.seed.owner) { this.emit({ status: "guest", message: "Sign in to save to My Games" }); return; }
    if (this.user !== this.seed.owner) { this.emit({ status: "session", message: "Sign in to the original account to resume saving." }); return; }
    if (!this.state.dirty) { this.emit({ status: "saved", message: "Saved" }); return; }
    this.emit({ status: "pending", message: "Waiting to save…" }); this.retries = 0; void this.flush();
  }
  async copy(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    if (!this.user || this.user !== this.seed.owner) return;
    this.seed = { id: crypto.randomUUID(), owner: this.user, revision: null, dirty: true };
    this.creation = undefined; this.generation++; this.acknowledged = -1;
    this.emit({ status: "pending", message: "Saving a copy…" });
    const url = new URL(location.href); url.search = `?draft=${this.seed.id}`;
    window.history.replaceState(null, "", url);
    await this.persist(); await this.flush();
  }
  get identity() { return { ...this.seed }; }
  dispose(persist = true) { if (this.disposed) return; this.disposed = true; clearTimeout(this.timer); clearTimeout(this.localTimer); if (persist) void this.persist(); }
}
