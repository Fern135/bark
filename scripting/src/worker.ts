import type { PyodideInterface } from "pyodide";
import type { HostMessage, WorkerMessage } from "./types.js";
import pythonApi from "./python/bark.py?raw";

const scope = globalThis as unknown as {
  postMessage(message: WorkerMessage): void;
  onmessage: ((event: MessageEvent<HostMessage>) => void) | null;
};
let session = 0,
  py: PyodideInterface,
  game: any,
  inspectionEnabled = false,
  requestId = 0,
  failed = false;
const pending = new Map<
  number,
  { resolve(value: string): void; reject(error: Error): void }
>();
function send(message: Record<string, unknown>) {
  scope.postMessage({ ...message, session } as WorkerMessage);
}
function error(error: unknown) {
  if (failed) return;
  failed = true;
  send({
    type: "error",
    diagnostic: {
      message: error instanceof Error ? error.message : String(error),
    },
  });
}
const output = { stdout: "", stderr: "" };
let outputTimer: ReturnType<typeof setTimeout> | undefined;
function print(stream: "stdout" | "stderr", text: string) {
  if (output[stream].length < 8192)
    output[stream] += text.slice(0, 8192) + "\n";
  if (!outputTimer)
    outputTimer = setTimeout(() => {
      outputTimer = undefined;
      for (const stream of ["stdout", "stderr"] as const)
        if (output[stream]) {
          send({ type: "output", stream, text: output[stream] });
          output[stream] = "";
        }
    }, 30);
}
scope.onmessage = async ({ data: message }) => {
  try {
    if (message.type === "prepare") {
      session = message.session;
      inspectionEnabled = message.inspect ?? false;
      const { loadPyodide } = await import(
        /* @vite-ignore */ new URL("pyodide.mjs", message.runtimeUrl).href
      );
      py = await loadPyodide({
        indexURL: message.runtimeUrl,
        stdout: (text: string) => print("stdout", text),
        stderr: (text: string) => print("stderr", text),
      });
      py.registerJsModule("bark_bridge", {
        inspect_json(payload: string) {
          send({ type: "inspection", snapshot: JSON.parse(payload) });
        },
        request_json(payload: string) {
          if (pending.size >= 256)
            return Promise.reject(new Error("Script command queue overflow."));
          const request = ++requestId;
          return new Promise<string>((resolve, reject) => {
            pending.set(request, { resolve, reject });
            const { scriptId, ...operation } = JSON.parse(payload);
            send({ type: "request", request, operation, scriptId });
          });
        },
        report_error(payload: string) {
          if (!failed) {
            failed = true;
            send({ type: "error", diagnostic: JSON.parse(payload) });
          }
        },
      });
      py.FS.writeFile("/home/pyodide/bark.py", pythonApi);
      const api = py.pyimport("bark");
      game = api.game.copy();
      api.destroy();
      game._inspect(inspectionEnabled);
      game._load_program(JSON.stringify(message.scripts ?? [{ scriptId: null, python: message.python }]));
      if (!failed) send({ type: "ready" });
      return;
    }
    if (message.session !== session || failed) return;
    switch (message.type) {
      case "inspect":
        inspectionEnabled = message.enabled;
        game?._inspect(inspectionEnabled);
        break;
      case "response": {
        const request = pending.get(message.request);
        pending.delete(message.request);
        if (message.error) request?.reject(new Error(message.error));
        else request?.resolve(JSON.stringify(message.result ?? null));
        break;
      }
      case "event":
        game._event(JSON.stringify(message.event));
        send({ type: "event_ack" });
        break;
      case "tick":
        game._tick(
          message.clock.elapsed,
          message.clock.tick,
          message.clock.delta,
        );
        send({ type: "tick_ack" });
        break;
      case "pause":
        game._pause();
        break;
      case "resume":
        game._resume();
        break;
    }
  } catch (cause) {
    error(cause);
  }
};
