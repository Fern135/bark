export type ByteSuggestion = {
  category: "bug" | "improvement" | "idea";
  message: string;
  issueKey: string;
  line: number | null;
  blockId: string | null;
};
export type ByteSnapshot = {
  language: "blocks" | "python";
  python: string;
  sourceMap: Record<number, string>;
  blocks: { id: string; label: string; type: string; fields: unknown }[];
  context: unknown;
  diagnostics: { message: string; line?: number; blockId?: string }[];
};
export type DismissedIssue = { issueKey: string; message: string; target: string };
export type ByteRequest = { revision: string; snapshot: ByteSnapshot; dismissed: DismissedIssue[]; intent?: "review" | "idea" };
export type ByteResponse = { revision: string; suggestion: ByteSuggestion | null };
type ReviewInput = {
  identity: string;
  key: string;
  localRevision: number;
  enabled: boolean;
  active: boolean;
  snapshot: () => ByteSnapshot | null;
};

export class ByteReviewError extends Error {
  constructor(public retryMs = 120_000) { super("Byte review unavailable"); }
}

// Owns timing and stale-response policy independently of React's render cycle.
export class ByteHints {
  private input?: ReviewInput;
  private pending = false;
  private editedAt = 0;
  private requestAt = -Infinity;
  private shownAt = -Infinity;
  private retryAt = 0;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private blocked = false;
  private seen = new Set<string>();
  private dismissed: DismissedIssue[] = [];
  private listeners = new Set<() => void>();
  private suggestion: ByteSuggestion | null = null;
  private intent: "review" | "idea" = "review";
  private status: "idle" | "reviewing" | "unavailable" | "waiting" = "idle";
  constructor(private review: (body: ByteRequest, signal: AbortSignal) => Promise<ByteResponse>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.suggestion;
  getStatus = () => this.status;
  private setStatus(value: typeof this.status) {
    if (this.status === value) return;
    this.status = value;
    this.listeners.forEach((listener) => listener());
  }
  requestNow = (intent: "review" | "idea" = "idea") => {
    if (!this.input?.enabled || !this.input.active || this.request) return;
    this.intent = intent;
    this.pending = true;
    this.editedAt = Date.now() - 5000;
    this.setStatus("waiting");
    this.schedule();
  };
  private show(value: ByteSuggestion | null) {
    if (value === this.suggestion) return;
    this.suggestion = value;
    this.listeners.forEach((listener) => listener());
  }
  update(input: ReviewInput) {
    const old = this.input;
    this.input = input;
    const identityChanged = old?.identity !== input.identity;
    const changed = old?.key !== input.key;
    if (identityChanged) {
      this.dismissed = []; this.seen.clear(); this.pending = false;
    }
    if (changed || identityChanged || !input.active || !input.enabled) this.invalidate();
    if (changed) {
      this.intent = "review";
      this.pending = !!old && !identityChanged && input.localRevision !== old.localRevision && input.enabled && input.active;
      this.editedAt = Date.now();
    }
    if (!input.enabled) this.pending = false;
    this.schedule();
  }
  activity(blocked: boolean) {
    this.blocked = blocked;
    this.editedAt = Date.now();
    if (blocked) this.invalidate(false);
    this.schedule();
  }
  private invalidate(clear = true) {
    this.generation++;
    clearTimeout(this.timer);
    this.request?.abort(); this.request = undefined;
    if (this.status === "reviewing" || this.status === "waiting") this.setStatus("idle");
    if (clear) this.show(null);
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.pending || !this.input?.enabled || !this.input.active || this.blocked || this.request) return;
    const at = Math.max(this.editedAt + 5000, this.requestAt + 45_000, this.shownAt + 45_000, this.retryAt);
    this.timer = setTimeout(() => { void this.run(); }, Math.max(0, at - Date.now()));
  }
  private async run() {
    const input = this.input;
    if (!input?.enabled || !input.active || this.blocked || !this.pending) return;
    this.pending = false;
    let snapshot: ByteSnapshot | null;
    try { snapshot = input.snapshot(); } catch { return; }
    if (!snapshot) return;
    const revision = String(++this.generation);
    const body = { revision, snapshot, dismissed: this.dismissed.slice(-20), intent: this.intent };
    if (new TextEncoder().encode(JSON.stringify(body)).length > 64 * 1024) return;
    const controller = new AbortController(); this.request = controller;
    this.setStatus("reviewing");
    this.requestAt = Date.now();
    try {
      const result = await this.review(body, controller.signal);
      if (controller.signal.aborted || revision !== String(this.generation) || result.revision !== revision) return;
      this.setStatus("idle");
      const suggestion = result.suggestion;
      if (suggestion === null) return;
      if (!validSuggestion(suggestion, snapshot)) throw new ByteReviewError();
      if (this.seen.has(suggestion.issueKey)) return;
      const target = suggestion.category === "idea" ? "" : (suggestion.blockId ?? snapshot.python.split("\n")[(suggestion.line ?? 1) - 1].trim()).slice(0, 400);
      if (target && this.dismissed.some((issue) => issue.target === target)) return;
      this.seen.add(suggestion.issueKey);
      this.dismissed.push({ issueKey: suggestion.issueKey, message: suggestion.message, target });
      this.shownAt = Date.now();
      this.show(suggestion);
    } catch (error) {
      if (!controller.signal.aborted) { this.retryAt = Date.now() + Math.max(120_000, error instanceof ByteReviewError ? error.retryMs : 0); this.setStatus("unavailable"); }
    } finally {
      if (this.request === controller) this.request = undefined;
      this.schedule();
    }
  }
  dismiss = () => { this.show(null); };
  dispose() { this.pending = false; this.invalidate(); }
}

export function validSuggestion(value: ByteSuggestion, snapshot: ByteSnapshot): boolean {
  if (!value || !["bug", "improvement", "idea"].includes(value.category) || typeof value.message !== "string" || !value.message.trim() || value.message.length > 320 || typeof value.issueKey !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(value.issueKey)) return false;
  if (value.category === "idea") return value.line === null && value.blockId === null;
  if (value.line !== null && (!Number.isInteger(value.line) || value.line < 1 || value.line > snapshot.python.split("\n").length)) return false;
  return snapshot.language === "blocks"
    ? snapshot.blocks.some((block) => block.id === value.blockId) && (value.line === null || snapshot.sourceMap[value.line] === value.blockId)
    : value.blockId === null && value.line !== null;
}
