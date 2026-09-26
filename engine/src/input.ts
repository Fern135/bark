import type { ActionState, InputBindings } from "./types.js";
import type { Events } from "./events.js";

export class Input {
  private codes = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private states = new Map<string, ActionState>();
  private position = { x: 0, y: 0 };
  private enabled = false;
  private mapping: InputBindings = {};
  private cleanup: (() => void)[] = [];
  constructor(private readonly canvas: HTMLCanvasElement | undefined, private readonly events: Events) {
    if (!canvas) return;
    const listen = (target: EventTarget, name: string, fn: EventListener) => { target.addEventListener(name, fn); this.cleanup.push(() => target.removeEventListener(name, fn)); };
    listen(canvas, "pointerdown", ((event: PointerEvent) => { canvas.focus(); this.feed(`Mouse${event.button}`, true); }) as EventListener);
    listen(window, "pointerup", ((event: PointerEvent) => this.feed(`Mouse${event.button}`, false)) as EventListener);
    listen(canvas, "pointermove", ((event: PointerEvent) => { const r = canvas.getBoundingClientRect(); this.position = { x: (event.clientX - r.left) / r.width * 2 - 1, y: 1 - (event.clientY - r.top) / r.height * 2 }; }) as EventListener);
    listen(window, "keydown", ((event: KeyboardEvent) => { if (!this.enabled || document.activeElement !== canvas) return; if (Object.values(this.mapping).some((keys) => keys.includes(event.code))) event.preventDefault(); this.feed(event.code, true); }) as EventListener);
    listen(window, "keyup", ((event: KeyboardEvent) => this.feed(event.code, false)) as EventListener);
    listen(canvas, "blur", () => this.clear()); listen(window, "blur", () => this.clear());
    listen(document, "visibilitychange", () => { if (document.hidden) this.clear(); });
  }
  configure(bindings: InputBindings): void { this.mapping = structuredClone(bindings); this.clear(); }
  bindings(): InputBindings { return structuredClone(this.mapping); }
  setEnabled(enabled: boolean): void { this.enabled = enabled; this.clear(); }
  /** Also used by headless input tests; DOM listeners enforce focus ownership. */
  feed(code: string, down: boolean): void {
    if (down && (!this.enabled || (this.canvas && document.activeElement !== this.canvas))) return;
    if (down && !this.codes.has(code)) this.pressed.add(code);
    if (!down && this.codes.has(code)) this.released.add(code);
    if (down) this.codes.add(code); else this.codes.delete(code);
  }
  sample(): void {
    for (const [name, keys] of Object.entries(this.mapping)) {
      const previous = this.action(name);
      const state = { held: keys.some((key) => this.codes.has(key)), pressed: keys.some((key) => this.pressed.has(key)), released: keys.some((key) => this.released.has(key)) };
      this.states.set(name, state);
      if (state.pressed || state.released || state.held !== previous.held) this.events.emit("input", { action: name, state: { ...state } });
    }
    this.pressed.clear(); this.released.clear();
  }
  action(name: string): ActionState { return { ...(this.states.get(name) ?? { pressed: false, held: false, released: false }) }; }
  pointer(): { x: number; y: number } { return { ...this.position }; }
  clear(): void { this.codes.clear(); this.pressed.clear(); this.released.clear(); this.states.clear(); }
  dispose(): void { for (const dispose of this.cleanup) dispose(); this.cleanup = []; this.clear(); }
}
