import type {
  AdapterState,
  Clock,
  EngineAdapter,
  GameplayEvent,
  HostMessage,
  Operation,
  WorkerMessage,
  WorkerPort,
} from "../src/types";
import type {
  CollabClientMessage,
  CollabPort,
  CollabServerMessage,
} from "../src/collab/types";

/** A CollabPort with no socket, so the client's state machine is testable offline. */
export class FakeCollabPort implements CollabPort {
  sent: CollabClientMessage[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((message: CollabServerMessage) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  send(message: CollabClientMessage) {
    this.sent.push(message);
  }
  close() {
    this.closed = true;
  }
  /** Pretend the socket opened. */
  open() {
    this.onopen?.();
  }
  /** Deliver a server frame. */
  deliver(message: CollabServerMessage) {
    this.onmessage?.(message);
  }
  /** Pretend the socket dropped. */
  drop() {
    this.onclose?.();
  }
  /** The last frame of a given type, which is what assertions usually want. */
  last<T extends CollabClientMessage["type"]>(
    type: T,
  ): Extract<CollabClientMessage, { type: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--)
      if (this.sent[i].type === type)
        return this.sent[i] as Extract<CollabClientMessage, { type: T }>;
    return undefined;
  }
  ofType<T extends CollabClientMessage["type"]>(
    type: T,
  ): Extract<CollabClientMessage, { type: T }>[] {
    return this.sent.filter((message) => message.type === type) as Extract<
      CollabClientMessage,
      { type: T }
    >[];
  }
}

export class FakeWorker implements WorkerPort {
  messages: HostMessage[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: HostMessage) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  send(message: Record<string, unknown>) {
    this.onmessage?.({
      data: { session: this.messages[0].session, ...message },
    } as MessageEvent<WorkerMessage>);
  }
}
export class FakeAdapter implements EngineAdapter {
  state: AdapterState = "editing";
  clock: Clock = { elapsed: 0, tick: 0, delta: 1 / 60 };
  operations: Operation[] = [];
  updates = new Set<(clock: Clock) => void>();
  events = new Set<(event: GameplayEvent) => void>();
  states = new Set<(state: AdapterState) => void>();
  transition(state: AdapterState) {
    this.state = state;
    this.states.forEach((fn) => fn(state));
  }
  play() {
    this.updates.clear();
    this.events.clear();
    this.transition("running");
  }
  pause() {
    this.transition("paused");
  }
  resume() {
    this.transition("running");
  }
  stop() {
    this.updates.clear();
    this.events.clear();
    this.clock = { elapsed: 0, tick: 0, delta: 1 / 60 };
    this.transition("editing");
  }
  execute(operation: Operation) {
    this.operations.push(operation);
    if ("id" in operation && operation.id === "missing") throw new Error("Entity not found");
    return { x: 1, y: 2, z: 3 };
  }
  onUpdate(fn: (clock: Clock) => void) {
    this.updates.add(fn);
    return () => {
      this.updates.delete(fn);
    };
  }
  onEvent(fn: (event: GameplayEvent) => void) {
    this.events.add(fn);
    return () => {
      this.events.delete(fn);
    };
  }
  onState(fn: (state: AdapterState) => void) {
    this.states.add(fn);
    return () => {
      this.states.delete(fn);
    };
  }
  step() {
    if (this.state !== "running") return;
    this.clock = {
      ...this.clock,
      elapsed: this.clock.elapsed + this.clock.delta,
      tick: this.clock.tick + 1,
    };
    this.updates.forEach((fn) => fn(this.clock));
  }
}
