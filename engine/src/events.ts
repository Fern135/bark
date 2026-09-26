import type { EngineEvents } from "./types.js";
export class Events {
  private listeners = new Set<{ type: keyof EngineEvents; fn: (value: never) => void; session: boolean }>();
  constructor(private readonly failed: (error: unknown) => void = () => {}) {}
  on<K extends keyof EngineEvents>(type: K, fn: (value: EngineEvents[K]) => void, session = false): () => void {
    const entry = { type, fn: fn as (value: never) => void, session };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }
  emit<K extends keyof EngineEvents>(type: K, value: EngineEvents[K]): void {
    for (const entry of [...this.listeners]) {
      if (!this.listeners.has(entry) || entry.type !== type) continue;
      try { entry.fn(structuredClone(value) as never); } catch (error) { if (type !== "error") this.failed(error); }
    }
  }
  clear(sessionOnly = false): void { for (const entry of this.listeners) if (!sessionOnly || entry.session) this.listeners.delete(entry); }
}
