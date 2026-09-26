import type { ErrorCode } from "./types.js";
export class EngineError extends Error {
  constructor(public readonly code: ErrorCode, message: string, options?: ErrorOptions) { super(message, options); this.name = "EngineError"; }
}
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new EngineError("INVALID_ARGUMENT", message);
}
export function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new EngineError("CANCELLED", "Operation cancelled.");
}
