import { EngineError } from "@bark/engine";
import type { FeedbackSnapshot, GameRuntime } from "@bark/engine";
import { checkCancelled, compileGame, parseGame, GameFileError } from "./game-file.js";
import type { GameFile, GameFileOptions } from "./game-file.js";
import type { Diagnostic, ScriptingSession } from "./types.js";

export type PlayerStatus = "empty" | "loading" | "ready" | "preparing" | "running" | "paused" | "error" | "disposed";
export interface PlayerSnapshot { status: PlayerStatus; name: string | null }
export interface PlayerOutput { text: string; stream: "stdout" | "stderr" }
export interface GamePlayer {
  readonly status: PlayerStatus;
  getSnapshot(): PlayerSnapshot;
  getFeedback(): FeedbackSnapshot;
  load(json: string, options?: GameFileOptions): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  restart(): Promise<void>;
  resize(): void;
  dispose(): void;
  onStatus(listener: (snapshot: PlayerSnapshot) => void): () => void;
  onFeedback(listener: (feedback: FeedbackSnapshot) => void): () => void;
  onOutput(listener: (output: PlayerOutput) => void): () => void;
  onDiagnostic(listener: (diagnostic: Diagnostic) => void): () => void;
}

/** Internal seam: production owns a WebGL runtime; tests can supply real Havok on NullEngine. */
export function createPlayerController(runtime: GameRuntime, session: ScriptingSession): GamePlayer {
  let document: GameFile | undefined, status: PlayerStatus = "empty", generation = 0;
  let pending: AbortController | undefined, internal = false;
  let diagnosticGeneration = -1;
  const statuses = new Set<(value: PlayerSnapshot) => void>();
  const feedbacks = new Set<(value: FeedbackSnapshot) => void>();
  const outputs = new Set<(value: PlayerOutput) => void>();
  const diagnostics = new Set<(value: Diagnostic) => void>();
  const snapshot = (): PlayerSnapshot => ({ status, name: document?.project.name ?? null });
  function emit<T>(listeners: Set<(value: T) => void>, value: T) {
    const epoch = generation;
    for (const listener of [...listeners]) {
      if (epoch !== generation) break;
      // Observers do not own lifecycle completion or the engine render loop.
      try { listener(structuredClone(value)); } catch (error) { console.error("Player observer failed", error); }
    }
  }
  function setStatus(value: PlayerStatus) { status = value; emit(statuses, snapshot()); }
  function report(error: unknown) {
    if (diagnosticGeneration === generation) return;
    diagnosticGeneration = generation;
    const diagnostic = error instanceof GameFileError ? error.diagnostics[0] : undefined;
    emit(diagnostics, diagnostic ?? { message: error instanceof Error ? error.message : String(error) });
  }
  function alive() { if (status === "disposed") throw new EngineError("DISPOSED", "Player has been disposed."); }
  function requireStatus(expected: PlayerStatus) {
    alive(); if (status !== expected) throw new EngineError("INVALID_STATE", `Expected player state ${expected}, got ${status}.`);
  }
  function current(epoch: number, signal?: AbortSignal) {
    checkCancelled(signal);
    if (epoch !== generation) throw new EngineError("CANCELLED", "Game operation replaced or stopped.");
    alive();
  }
  function silently(action: () => void) {
    const previous = internal; internal = true;
    try { action(); } finally { internal = previous; }
  }
  function invalidate() { generation++; pending?.abort(); pending = undefined; }
  function subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void) {
    alive(); listeners.add(listener); return () => { listeners.delete(listener); };
  }
  const cleanups = [
    session.onStatus((value) => {
      if (internal || status === "disposed" || status === "loading") return;
      if (["running", "paused", "error"].includes(value)) setStatus(value as PlayerStatus);
    }),
    session.onOutput((value) => emit(outputs, { text: value.text, stream: value.stream })),
    session.onDiagnostic((value) => {
      if (!internal && status !== "loading") { diagnosticGeneration = generation; emit(diagnostics, value); }
    }),
    runtime.on("feedback", (value) => { if (!internal && status !== "loading") emit(feedbacks, value); }, { scope: "runtime" }),
  ];
  const player: GamePlayer = {
    get status() { return status; },
    getSnapshot: snapshot,
    getFeedback: () => structuredClone(runtime.feedback.get()),
    async load(json, options = {}) {
      alive(); checkCancelled(options.signal);
      const wasLoading = status === "loading" || status === "preparing";
      invalidate();
      if (wasLoading) silently(() => session.stop());
      const previous = wasLoading ? (document ? "ready" : "empty") : status;
      const epoch = generation, controller = new AbortController(); pending = controller;
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      let replacing = false;
      setStatus("loading");
      try {
        current(epoch, controller.signal);
        const next = await parseGame(json, { ...options, signal: controller.signal });
        current(epoch, controller.signal);
        replacing = true;
        silently(() => session.stop());
        current(epoch, controller.signal);
        await runtime.load(next.project, { signal: controller.signal });
        current(epoch, controller.signal);
        document = next; pending = undefined;
        setStatus("ready");
        current(epoch);
        emit(feedbacks, runtime.feedback.get());
      } catch (error) {
        if (epoch === generation && status !== "disposed") {
          pending = undefined;
          if (replacing) silently(() => session.stop());
          setStatus(replacing ? (document ? "ready" : "empty") : previous);
          if (epoch === generation && !controller.signal.aborted) report(error);
          if (epoch === generation && replacing) emit(feedbacks, runtime.feedback.get());
        }
        throw error;
      } finally { options.signal?.removeEventListener("abort", abort); }
    },
    async play() {
      requireStatus("ready");
      const epoch = ++generation;
      setStatus("preparing");
      try {
        current(epoch);
        const compilation = await compileGame(document!);
        current(epoch);
        await session.prepare(compilation);
        current(epoch);
        // Suppress intermediate session events; publish once all setup has completed.
        silently(() => session.play());
        current(epoch);
        if (session.status !== "running") throw new Error("The game could not start.");
        setStatus("running");
        current(epoch);
        emit(feedbacks, runtime.feedback.get());
      } catch (error) {
        if (epoch === generation && status !== "disposed") {
          silently(() => session.stop());
          setStatus("error");
          if (epoch === generation) report(error);
        }
        throw error;
      }
    },
    pause() { requireStatus("running"); session.pause(); },
    resume() { requireStatus("paused"); session.resume(); },
    stop() {
      alive(); invalidate(); const epoch = generation;
      silently(() => session.stop()); setStatus(document ? "ready" : "empty");
      if (epoch === generation) emit(feedbacks, runtime.feedback.get());
    },
    async restart() { alive(); if (!document) throw new EngineError("INVALID_STATE", "Load a game first."); player.stop(); await player.play(); },
    resize() { runtime.resize(); },
    dispose() {
      if (status === "disposed") return;
      invalidate();
      silently(() => { session.dispose(); cleanups.forEach((off) => off()); runtime.dispose(); });
      document = undefined; setStatus("disposed");
      statuses.clear(); feedbacks.clear(); outputs.clear(); diagnostics.clear();
    },
    onStatus: (fn) => subscribe(statuses, fn),
    onFeedback: (fn) => subscribe(feedbacks, fn),
    onOutput: (fn) => subscribe(outputs, fn),
    onDiagnostic: (fn) => subscribe(diagnostics, fn),
  };
  return player;
}
