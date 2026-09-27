import type {
  Clock,
  Compilation,
  CompiledProgram,
  Diagnostic,
  EngineAdapter,
  GameplayEvent,
  HostMessage,
  ScriptingSession,
  SessionStatus,
  WorkerMessage,
  WorkerPort,
  Inspection,
} from "./types.js";

export const SESSION_LIMITS = { commands: 256, events: 256 };
export function createScriptingSession(
  adapter: EngineAdapter,
  options: { runtimeUrl?: string; workerFactory?: () => WorkerPort } = {},
): ScriptingSession {
  let status: SessionStatus = "idle",
    generation = 0,
    worker: WorkerPort | undefined;
  let compiled: Compilation | CompiledProgram = { python: "", sourceMap: {}, diagnostics: [] };
  let pendingPrepare:
    { resolve(): void; reject(error: Error): void } | undefined;
  const destroyed = new Set<string>();
  let commands: Extract<WorkerMessage, { type: "request" }>[] = [];
  let tickInFlight = false,
    pendingTick: Clock | undefined,
    eventsInFlight = 0,
    internal = false;
  let cleanup: (() => void)[] = [];
  let outstanding = 0,
    inspect = false;
  const inspections = new Set<(snapshot: Inspection) => void>();
  const statuses = new Set<(value: SessionStatus) => void>();
  const outputs = new Set<
    (value: { text: string; stream: "stdout" | "stderr" }) => void
  >();
  const diagnostics = new Set<(value: Diagnostic) => void>();
  const setStatus = (value: SessionStatus) => {
    status = value;
    statuses.forEach((fn) => fn(value));
  };
  const post = (message: Omit<HostMessage, "session">) =>
    worker?.postMessage({ ...message, session: generation } as HostMessage);
  const lifecycle = (action: () => void) => {
    internal = true;
    try {
      action();
    } finally {
      internal = false;
    }
  };
  function clear(reason: string) {
    generation++;
    outstanding = 0;
    adapter.clearMovement?.();
    worker?.terminate();
    worker = undefined;
    commands = [];
    destroyed.clear();
    pendingTick = undefined;
    tickInFlight = false;
    eventsInFlight = 0;
    cleanup.forEach((fn) => fn());
    cleanup = [];
    pendingPrepare?.reject(new Error(reason));
    pendingPrepare = undefined;
  }
  function fail(diagnostic: Diagnostic) {
    if (status === "disposed" || status === "error") return;
    const blockId = diagnostic.line
      ? ("scripts" in compiled ? compiled.scripts.find((s) => s.scriptId === (diagnostic.scriptId ?? null)) : compiled)?.sourceMap[diagnostic.line]
      : undefined;
    clear(diagnostic.message);
    if (adapter.state === "running") lifecycle(() => adapter.pause());
    setStatus("error");
    diagnostics.forEach((fn) => fn({ ...diagnostic, blockId }));
  }
  function sendTick(clock: Clock) {
    if (status !== "running") return;
    if (tickInFlight) {
      pendingTick = { ...clock };
      return;
    }
    pendingTick = undefined;
    tickInFlight = true;
    post({ type: "tick", clock } as Omit<HostMessage, "session">);
  }
  function event(event: GameplayEvent) {
    if (status !== "running") return;
    if (event.type === "destroy") destroyed.add(event.entityId);
    if (++eventsInFlight > SESSION_LIMITS.events) {
      fail({
        message: "Script event queue overflow. Add waits or simplify handlers.",
      });
      return;
    }
    post({ type: "event", event } as Omit<HostMessage, "session">);
  }
  function receive(message: WorkerMessage) {
    if (message.session !== generation || !worker) return;
    switch (message.type) {
      case "ready":
        if (status !== "preparing") return;
        setStatus("ready");
        pendingPrepare?.resolve();
        pendingPrepare = undefined;
        return;
      case "request":
        if (status !== "running" && status !== "paused") {
          post({
            type: "response",
            request: message.request,
            error: "Use engine operations inside an event handler, after Play.",
          } as Omit<HostMessage, "session">);
          return;
        }
        if (outstanding >= SESSION_LIMITS.commands) {
          fail({ message: "Script command queue overflow." });
          return;
        }
        commands.push(message);
        outstanding++;
        return;
      case "inspection":
        if (inspect)
          inspections.forEach((fn) =>
            fn({
              ...message.snapshot,
              blockId: message.snapshot.line
                ? ("scripts" in compiled ? compiled.scripts.find((s) => s.scriptId === (message.snapshot.scriptId ?? null)) : compiled)?.sourceMap[message.snapshot.line]
                : undefined,
            }),
          );
        return;
      case "output":
        outputs.forEach((fn) => fn(message));
        return;
      case "error":
        fail(message.diagnostic);
        return;
      case "event_ack":
        eventsInFlight = Math.max(0, eventsInFlight - 1);
        return;
      case "tick_ack":
        tickInFlight = false;
        if (status === "running" && pendingTick) {
          const clock = pendingTick;
          pendingTick = undefined;
          sendTick(clock);
        }
    }
  }
  const offState = adapter.onState((state) => {
    if (internal || status === "disposed") return;
    if (state === "paused" && status === "running") {
      adapter.clearMovement?.();
      post({ type: "pause" });
      setStatus("paused");
    } else if (state === "running" && status === "paused") {
      post({ type: "resume" });
      setStatus("running");
    } else if (state === "error")
      fail({
        message:
          "The engine entered an error state. Stop to restore the world.",
      });
    else if (["loading", "editing", "empty", "disposed"].includes(state)) {
      clear("The engine world changed.");
      setStatus(state === "disposed" ? "disposed" : "idle");
    }
  });
  function requireStatus(expected: SessionStatus) {
    if (status !== expected)
      throw new Error(`Expected scripting state ${expected}, got ${status}.`);
  }
  return {
    get status() {
      return status;
    },
    async prepare(compilation) {
      if (!["idle", "ready", "preparing"].includes(status))
        throw new Error("Stop before preparing another script.");
      if (adapter.state !== "editing")
        throw new Error("Load an editable engine world before preparing.");
      clear("Script preparation was replaced.");
      compiled = compilation;
      if (compilation.diagnostics.length) {
        fail(compilation.diagnostics[0]);
        throw new Error(compilation.diagnostics[0].message);
      }
      setStatus("preparing");
      const ready = new Promise<void>((resolve, reject) => {
        pendingPrepare = { resolve, reject };
      });
      try {
        worker =
          options.workerFactory?.() ??
          new Worker(new URL("./worker.ts", import.meta.url), {
            type: "module",
          });
        worker.onmessage = (e) => receive(e.data);
        worker.onerror = (e) =>
          fail({ message: e.message || "Python worker failed to load." });
        const base =
          typeof location === "undefined" ? "http://localhost/" : location.href;
        post({
          type: "prepare",
          python: compilation.python,
          scripts: "scripts" in compilation ? compilation.scripts : undefined,
          runtimeUrl: new URL(options.runtimeUrl ?? "/pyodide/", base).href,
          inspect,
        } as Omit<HostMessage, "session">);
      } catch (error) {
        fail({ message: String(error) });
      }
      return ready;
    },
    play() {
      requireStatus("ready");
      try {
        lifecycle(() => adapter.play());
        cleanup = [
          adapter.onUpdate((clock) => {
            if (status !== "running") return;
            const batch = commands;
            commands = [];
            for (const [index, command] of batch.entries()) {
              // Engine observers may Stop or Pause synchronously during an operation.
              if (command.session !== generation) break;
              if (status !== "running") {
                commands.unshift(...batch.slice(index));
                break;
              }
              try {
                const respond = (result?: unknown, error?: string) => {
                  if (command.session !== generation || !worker) return;
                  outstanding--;
                  post({
                    type: "response",
                    request: command.request,
                    result: result ?? null,
                    error,
                  } as Omit<HostMessage, "session">);
                };
                if (command.scriptId && destroyed.has(command.scriptId)) { respond(undefined, "The script owner was destroyed."); continue; }
                const result = adapter.execute(command.operation);
                if (
                  result &&
                  typeof (result as PromiseLike<unknown>).then === "function"
                )
                  Promise.resolve(result).then(
                    (value) => respond(value),
                    (error) =>
                      respond(
                        undefined,
                        error instanceof Error ? error.message : String(error),
                      ),
                  );
                else respond(result);
              } catch (error) {
                if (command.session !== generation) break;
                outstanding--;
                post({
                  type: "response",
                  request: command.request,
                  error: error instanceof Error ? error.message : String(error),
                } as Omit<HostMessage, "session">);
              }
            }
            sendTick(clock);
          }),
          adapter.onEvent(event),
        ];
        setStatus("running");
        event({ type: "start" });
      } catch (error) {
        fail({ message: String(error) });
      }
    },
    pause() {
      requireStatus("running");
      adapter.clearMovement?.();
      lifecycle(() => adapter.pause());
      post({ type: "pause" });
      setStatus("paused");
    },
    resume() {
      requireStatus("paused");
      lifecycle(() => adapter.resume());
      post({ type: "resume" });
      setStatus("running");
    },
    stop() {
      if (status === "disposed") return;
      clear("Script stopped.");
      if (!["disposed", "empty"].includes(adapter.state))
        lifecycle(() => adapter.stop());
      setStatus("idle");
    },
    dispose() {
      if (status !== "disposed") {
        clear("Session disposed.");
        if (["running", "paused", "error"].includes(adapter.state))
          lifecycle(() => adapter.stop());
        setStatus("disposed");
      }
      offState();
      statuses.clear();
      outputs.clear();
      diagnostics.clear();
      inspections.clear();
    },
    clearMovement() {
      adapter.clearMovement?.();
    },
    setInspection(enabled) {
      inspect = enabled;
      post({ type: "inspect", enabled } as Omit<HostMessage, "session">);
    },
    onInspection(fn) {
      inspections.add(fn);
      return () => {
        inspections.delete(fn);
      };
    },
    onStatus(fn) {
      statuses.add(fn);
      return () => {
        statuses.delete(fn);
      };
    },
    onOutput(fn) {
      outputs.add(fn);
      return () => {
        outputs.delete(fn);
      };
    },
    onDiagnostic(fn) {
      diagnostics.add(fn);
      return () => {
        diagnostics.delete(fn);
      };
    },
  };
}
