export type Vec3 = { x: number; y: number; z: number };
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Inspection = {
  scriptId?: string | null;
  line?: number;
  blockId?: string;
  globals: Record<string, unknown>;
  locals: Record<string, unknown>;
  activity: { handler: string; event: string; phase: string; time: number }[];
};
export type Clock = { elapsed: number; tick: number; delta: number };
export type ScriptDocument =
  | { language: "blocks"; workspace: Record<string, unknown> }
  | {
      language: "python";
      source: string;
      blocksBackup?: Record<string, unknown>;
    };
export interface GameDocument<Project = unknown> {
  version: 1 | 2;
  project: Project;
  script: ScriptDocument;
  objectScripts?: Record<string, ScriptDocument>;
}
export interface Diagnostic {
  scriptId?: string | null;
  message: string;
  line?: number;
  blockId?: string;
  traceback?: string;
}
export interface Compilation {
  python: string;
  sourceMap: Record<number, string>;
  diagnostics: Diagnostic[];
}
export interface CompiledProgram extends Compilation {
  scripts: (Compilation & { scriptId: string | null })[];
}
export interface ScriptCompiler<Input = ScriptDocument> {
  language: string;
  compile(script: Input): Compilation;
}
export type Operation =
  | { op: "walk" | "teleport" | "set_spawn"; id: string; vector: Vec3 }
  | { op: "jump" | "respawn"; id: string }
  | { op: "target"; actor: string }
  | { op: "interact"; actor: string; target?: string }
  | {
      op: "glide_to";
      id: string;
      vector: Vec3;
      seconds: number;
      easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
    }
  | {
      op: "rotate_to";
      id: string;
      degrees: number;
      seconds: number;
      easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
    }
  | {
      op: "property";
      id: string | null;
      action: "get" | "has" | "set" | "change" | "remove" | "list";
      key: string;
      value?: JsonValue;
    }
  | { op: "set_hud"; key: string; label: string; value: JsonValue }
  | { op: "remove_hud"; key: string }
  | { op: "notify"; text: string; seconds: number }
  | { op: "move"; id: string; vector: Vec3; space: "local" | "world" }
  | { op: "turn"; id: string; degrees: number }
  | {
      op: "set_velocity";
      id: string;
      vector: { x: number | null; y: number | null; z: number | null };
    }
  | { op: "apply_impulse"; id: string; vector: Vec3 }
  | { op: "destroy" | "position" | "velocity" | "grounded"; id: string }
  | { op: "find"; tag: string }
  | { op: "input"; action: string }
  | { op: "spawn"; prefab: string; position: Vec3 };
export type GameplayEvent =
  | { type: "start" }
  | { type: "destroy"; entityId: string }
  | {
      type: "input";
      action: string;
      state: { pressed: boolean; held: boolean; released: boolean };
    }
  | { type: "touch" | "touch_end"; entityId: string; otherId: string }
  | { type: "respawn"; entityId: string }
  | { type: "interact"; entityId: string; actorId?: string };
export type AdapterState =
  "empty" | "loading" | "editing" | "running" | "paused" | "error" | "disposed";
export interface EngineAdapter {
  readonly state: AdapterState;
  readonly clock: Clock;
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  execute(operation: Operation): unknown | Promise<unknown>;
  clearMovement?(): void;
  onUpdate(listener: (clock: Clock) => void): () => void;
  onEvent(listener: (event: GameplayEvent) => void): () => void;
  onState(listener: (state: AdapterState) => void): () => void;
}
export type SessionStatus =
  "idle" | "preparing" | "ready" | "running" | "paused" | "error" | "disposed";
export type HostMessage = { session: number } & (
  | { type: "prepare"; python: string; scripts?: CompiledProgram["scripts"]; runtimeUrl: string; inspect?: boolean }
  | { type: "inspect"; enabled: boolean }
  | { type: "event"; event: GameplayEvent }
  | { type: "tick"; clock: Clock }
  | { type: "pause" | "resume" }
  | { type: "response"; request: number; result?: unknown; error?: string }
);
export type WorkerMessage = { session: number } & (
  | { type: "ready" | "tick_ack" | "event_ack" }
  | { type: "request"; request: number; operation: Operation; scriptId?: string | null }
  | { type: "output"; text: string; stream: "stdout" | "stderr" }
  | { type: "error"; diagnostic: Diagnostic }
  | { type: "inspection"; snapshot: Inspection }
);
export interface WorkerPort {
  postMessage(message: HostMessage): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export interface ScriptingSession {
  readonly status: SessionStatus;
  prepare(compilation: Compilation | CompiledProgram): Promise<void>;
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;
  setInspection(enabled: boolean): void;
  clearMovement(): void;
  onInspection(listener: (snapshot: Inspection) => void): () => void;
  onStatus(listener: (status: SessionStatus) => void): () => void;
  onOutput(
    listener: (output: { text: string; stream: "stdout" | "stderr" }) => void,
  ): () => void;
  onDiagnostic(listener: (diagnostic: Diagnostic) => void): () => void;
}
