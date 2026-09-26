export type Vec3 = { x: number; y: number; z: number };
export type Clock = { elapsed: number; tick: number; delta: number };
export type ScriptDocument =
  | { language: "blocks"; workspace: Record<string, unknown> }
  | { language: "python"; source: string; blocksBackup?: Record<string, unknown> };
export interface GameDocument<Project = unknown> {
  version: 1;
  project: Project;
  script: ScriptDocument;
}
export interface Diagnostic {
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
export interface ScriptCompiler<Input = ScriptDocument> {
  language: string;
  compile(script: Input): Compilation;
}
export type Operation =
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
  | { type: "input"; action: string; state: { pressed: boolean; held: boolean; released: boolean } }
  | { type: "touch"; entityId: string; otherId: string }
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
  execute(operation: Operation): unknown;
  onUpdate(listener: (clock: Clock) => void): () => void;
  onEvent(listener: (event: GameplayEvent) => void): () => void;
  onState(listener: (state: AdapterState) => void): () => void;
}
export type SessionStatus =
  "idle" | "preparing" | "ready" | "running" | "paused" | "error" | "disposed";
export type HostMessage = { session: number } & (
  | { type: "prepare"; python: string; runtimeUrl: string }
  | { type: "event"; event: GameplayEvent }
  | { type: "tick"; clock: Clock }
  | { type: "pause" | "resume" }
  | { type: "response"; request: number; result?: unknown; error?: string }
);
export type WorkerMessage = { session: number } & (
  | { type: "ready" | "tick_ack" | "event_ack" }
  | { type: "request"; request: number; operation: Operation }
  | { type: "output"; text: string; stream: "stdout" | "stderr" }
  | { type: "error"; diagnostic: Diagnostic }
);
export interface WorkerPort {
  postMessage(message: HostMessage): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export interface ScriptingSession {
  readonly status: SessionStatus;
  prepare(compilation: Compilation): Promise<void>;
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;
  onStatus(listener: (status: SessionStatus) => void): () => void;
  onOutput(listener: (output: { text: string; stream: "stdout" | "stderr" }) => void): () => void;
  onDiagnostic(listener: (diagnostic: Diagnostic) => void): () => void;
}
