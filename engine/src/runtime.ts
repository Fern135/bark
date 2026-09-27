import HavokPhysics from "@babylonjs/havok";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine.js";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent.js";
import { RuntimeWorld, vector } from "./world.js";
import { Assets, abortable } from "./assets.js";
import { Events } from "./events.js";
import { Input } from "./input.js";
import { Cameras } from "./cameras.js";
import { Gameplay } from "./gameplay.js";
import { Placement } from "./placement.js";
import { EditorTools } from "./editor-tools.js";
import { EditorPresence } from "./editor-presence.js";
import { EngineError, cancelled } from "./errors.js";
import { validateProject, settings as validateSettings } from "./project.js";
import type { CameraSettings, ClockSnapshot, EngineCommand, EngineEvents, GameRuntime, ProjectDocument, RuntimeOptions, RuntimeState, SceneSettings, PropertyMap, RuntimeLimits } from "./types.js";

type Havok = Awaited<ReturnType<typeof HavokPhysics>>;
interface Bundle { scene: Scene; plugin: HavokPlugin; assets: Assets; world: RuntimeWorld; cameras: Cameras; ambient: HemisphericLight; sun: DirectionalLight; shadow: ShadowGenerator | null; settings: SceneSettings; tools?: EditorTools; presence?: EditorPresence }
const havokModules = new Map<string, Promise<Havok>>();
function loadHavok(url: string): Promise<Havok> {
  let loading = havokModules.get(url);
  if (!loading) { loading = HavokPhysics({ locateFile: () => url }).catch((e: unknown) => { havokModules.delete(url); throw e; }); havokModules.set(url, loading); }
  return loading;
}

/** Runtime orchestration is renderer-independent so lifecycle and timing can be tested with NullEngine. */
export class Runtime implements GameRuntime {
  private current: Bundle | null = null;
  private authored: ProjectDocument | null = null;
  private status: RuntimeState = "empty";
  private events = new Events((error) => this.fail(new EngineError("CALLBACK_ERROR", error instanceof Error ? error.message : String(error))));
  readonly input: Input;
  private updates = new Set<(clock: ClockSnapshot) => void>();
  private time: ClockSnapshot = { elapsed: 0, tick: 0, delta: 1 / 60 };
  private accumulator = 0;
  private generation = 0;
  private loading: AbortController | null = null;
  private constructing = false;
  private gameplay: Gameplay;
  private propertyValues: PropertyMap = {};
  private sessionEpoch = 0;
  readonly limits: RuntimeLimits;
  readonly placement: Placement;
  private toolOptions: Partial<import("./types.js").EditorToolOptions> | null = null;
  readonly editorTools = {
    presence: (peers: import("./types.js").EditorPeer[]) => {
      const bundle = this.bundle();
      bundle.presence ??= new EditorPresence(bundle.scene, bundle.world);
      bundle.presence.set(this.status === "editing" ? peers : []);
    },
    configure: (options: Partial<import("./types.js").EditorToolOptions>) => {
      const bundle = this.bundle();
      bundle.tools ??= new EditorTools(bundle.scene, bundle.world, bundle.cameras, this.events, () => this.status === "editing", this.canvas);
      bundle.tools.configure(options); this.toolOptions = bundle.tools.get();
    },
    get: () => { if (!this.bundle().tools) this.editorTools.configure({}); return this.bundle().tools!.get(); },
    cancel: () => this.current?.tools?.cancel(),
  };
  get characters() { return this.gameplay.characters; }
  get interactions() { return this.gameplay.interactions; }
  get properties() { return this.gameplay.properties; }
  get motion() { return this.gameplay.motion; }
  get feedback() { return this.gameplay.feedback; }
  private render = () => {
    try { this.advance(Math.min(this.engine.getDeltaTime() / 1000, 0.1)); this.current?.cameras.update(); this.current?.scene.render(); }
    catch (error) { if (this.status !== "error") this.fail(new EngineError("INVALID_STATE", `Rendering failed: ${error instanceof Error ? error.message : String(error)}`)); }
  };
  constructor(private readonly engine: AbstractEngine, private readonly havok: Havok, private readonly canvas?: HTMLCanvasElement, limits: Partial<RuntimeLimits> = {}) {
    this.limits = { entities: 2000, actions: 128, notifications: 32, ...limits };
    if (!Object.values(this.limits).every((n) => Number.isInteger(n) && n > 0)) throw new EngineError("INVALID_ARGUMENT", "Limits must be positive integers.");
    this.input = new Input(canvas, this.events);
    this.gameplay = new Gameplay(() => this.world, this.events, () => this.status, this.writable,
      () => { this.bundle(); return this.propertyValues; }, (values) => { this.propertyValues = values; if (this.status === "editing") this.authored!.properties = structuredClone(values); }, this.limits);
    this.placement = new Placement(() => this.world, () => this.bundle().scene, () => this.exportProject(), () => { this.alive(); if (this.status !== "editing") throw new EngineError("INVALID_STATE", "Placement requires editing mode."); });
    if (canvas) { canvas.tabIndex = 0; engine.runRenderLoop(this.render); }
  }
  get state(): RuntimeState { return this.status; }
  get world(): RuntimeWorld { return this.bundle().world; }
  get transforms() { return this.world.transforms; }
  get physics() { return this.world.physics; }
  get clock(): ClockSnapshot { return { ...this.time }; }
  get settings(): SceneSettings { return structuredClone(this.bundle().settings); }
  readonly assets = { list: () => structuredClone(this.bundle().assets.project.assets) };
  readonly cameras = {
    pose: () => this.bundle().cameras.pose(),
    project: (point: import("./types.js").Vec3) => this.bundle().cameras.project(point),
    frame: (id?: string, padding?: number) => { this.writable(); this.bundle().cameras.frame(id, padding); },
    get: () => this.bundle().cameras.get(),
    set: (value: Partial<CameraSettings>) => { this.writable(); this.bundle().cameras.set(value); if (this.status === "editing") this.authored!.cameras = this.bundle().cameras.get(); },
    forward: () => this.bundle().cameras.forward(),
    ray: (x: number, y: number) => { if (![x, y].every(Number.isFinite)) throw new EngineError("INVALID_ARGUMENT", "Pointer coordinates must be finite."); return this.bundle().cameras.ray(x, y); },
  };
  private alive(): void { if (this.status === "disposed") throw new EngineError("DISPOSED", "Runtime has been disposed."); }
  private bundle(): Bundle { this.alive(); if (!this.current) throw new EngineError("INVALID_STATE", "No world is loaded."); return this.current; }
  private writable = (): void => { this.alive(); if (!["editing", "running", "paused"].includes(this.status)) throw new EngineError("INVALID_STATE", `Cannot modify world while ${this.status}.`); };
  private transition(state: RuntimeState, feedback = false): void {
    const previous = this.status, epoch = this.sessionEpoch;
    this.status = state;
    const current = () => this.sessionEpoch === epoch && this.status === state;
    if (state !== previous) this.events.emit("state", { previous, state }, current);
    if (feedback && current()) this.gameplay.publish();
  }
  private fail(error: EngineError): void {
    if (this.status === "disposed" || this.status === "error") return;
    this.invalidateLoad(); this.resetSession(false); const epoch = this.sessionEpoch;
    this.transition("error", true);
    if (this.sessionEpoch === epoch && this.state === "error") this.events.emit("error", { code: error.code, message: error.message }, () => this.sessionEpoch === epoch);
  }
  private resetSession(resetClock = true): void {
    this.current?.presence?.set([]);
    this.current?.tools?.cancel();
    this.sessionEpoch++; this.events.clear(true); this.updates.clear();
    this.input.setEnabled(false); this.placement.cancel(); this.gameplay.reset(); this.accumulator = 0;
    if (resetClock) this.time = { elapsed: 0, tick: 0, delta: 1 / 60 };
  }
  private invalidateLoad(): void { this.generation++; this.loading?.abort(); this.loading = null; }
  private changed(bundle: Bundle): void {
    if (this.constructing) return;
    const map = bundle.shadow?.getShadowMap(); if (map) map.renderList = bundle.scene.meshes.filter((mesh) => !mesh.metadata?.preview);
    bundle.cameras?.update();
    if (this.status === "editing" && this.current === bundle && this.authored) {
      this.authored.entities = bundle.world.definitions();
      if (this.authored.cameras.targetId && !this.authored.entities.some((e) => e.id === this.authored!.cameras.targetId)) this.authored.cameras.targetId = null;
    }
  }
  private applySettings(bundle: Bundle, settings: SceneSettings): void {
    bundle.settings = structuredClone(settings); bundle.scene.clearColor = Color4.FromHexString(`${settings.background}FF`);
    bundle.ambient.intensity = settings.ambientIntensity; bundle.sun.intensity = settings.sunIntensity;
    bundle.plugin.setGravity(vector(settings.gravity));
    bundle.shadow?.dispose(); bundle.shadow = null;
    if (settings.shadows && this.canvas) { bundle.shadow = new ShadowGenerator(1024, bundle.sun); bundle.shadow.usePercentageCloserFiltering = true; bundle.shadow.bias = 0.003; bundle.shadow.normalBias = 0.05; bundle.shadow.getShadowMap()!.renderList = bundle.scene.meshes.filter((mesh) => !mesh.metadata?.preview); }
  }
  async load(value: unknown, options: { signal?: AbortSignal } = {}): Promise<void> {
    this.alive(); const project = validateProject(value); cancelled(options.signal);
    if (project.entities.length > this.limits.entities) throw new EngineError("LIMIT_EXCEEDED", `Entity limit is ${this.limits.entities}.`);
    this.invalidateLoad(); const generation = this.generation, controller = new AbortController(); this.loading = controller;
    const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true });
    this.resetSession(); this.transition("loading", true);
    if (generation !== this.generation) {
      options.signal?.removeEventListener("abort", abort);
      throw new EngineError("CANCELLED", "Load superseded.");
    }
    const scene = new Scene(this.engine); scene.physicsEnabled = false;
    const assets = new Assets(scene, project);
    let staged: Bundle | null = null;
    try {
      await assets.load(controller.signal); cancelled(controller.signal);
      const plugin = new HavokPlugin(false, this.havok); scene.enablePhysics(vector(project.settings.gravity), plugin); scene.physicsEnabled = false; plugin.setTimeStep(1 / 60);
      const ambient = new HemisphericLight("ambient", Vector3.Up(), scene);
      const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, 0.5), scene); sun.position = new Vector3(12, 20, -10);
      sun.autoCalcShadowZBounds = true;
      // Callbacks capture this bundle only after construction has finished.
      const world = new RuntimeWorld(scene, plugin, assets, this.events, () => { if (staged) this.changed(staged); }, this.writable, this.limits.entities);
      world.beforeMutation = (id, changes) => { staged?.tools?.cancel(); this.gameplay.mutation(id, changes); };
      this.constructing = true;
      try { world.replace(project.entities); } finally { this.constructing = false; }
      const cameras = new Cameras(scene, world, { ...project.cameras, active: "editor" }, this.canvas);
      staged = { scene, assets, plugin, world, cameras, ambient, sun, shadow: null, settings: project.settings };
      this.applySettings(staged, project.settings);
      await abortable(scene.whenReadyAsync(), controller.signal, () => {});
      cancelled(controller.signal);
      if (generation !== this.generation) throw new EngineError("CANCELLED", "Load superseded.");
      this.release(this.current); this.current = staged; this.authored = project; this.propertyValues = structuredClone(project.properties ?? {}); this.loading = null;
      this.input.configure(project.input); this.transition("editing"); this.resize();
      if (this.toolOptions) this.editorTools.configure(this.toolOptions);
    } catch (error) {
      if (staged) this.release(staged); else { assets.dispose(); scene.dispose(); }
      const failure = controller.signal.aborted ? new EngineError("CANCELLED", "Load cancelled.") : error instanceof EngineError ? error : new EngineError("ASSET_LOAD", String(error));
      if (generation === this.generation && this.status !== "disposed") {
        this.loading = null;
        if (failure.code === "CANCELLED") { this.restore(); this.transition(this.current ? "editing" : "empty"); }
        else this.fail(failure);
      }
      throw failure;
    } finally { options.signal?.removeEventListener("abort", abort); }
  }
  private restore(): void {
    if (!this.current || !this.authored) return;
    this.propertyValues = structuredClone(this.authored.properties ?? {});
    this.constructing = true;
    try { this.current.world.replace(this.authored.entities); this.applySettings(this.current, this.authored.settings); this.current.cameras.set({ ...this.authored.cameras, active: "editor" }); }
    finally { this.constructing = false; }
  }
  play(): void {
    this.alive(); if (this.status !== "editing") throw new EngineError("INVALID_STATE", "Play requires editing mode.");
    this.resetSession(); this.restore(); this.current!.cameras.set(this.authored!.cameras);
    this.input.setEnabled(true); this.transition("running", true);
  }
  pause(): void { if (this.status !== "running") throw new EngineError("INVALID_STATE", "Pause requires a running session."); this.input.setEnabled(false); this.gameplay.clearIntents(); this.accumulator = 0; this.transition("paused"); }
  resume(): void { if (this.status !== "paused") throw new EngineError("INVALID_STATE", "Resume requires a paused session."); this.input.setEnabled(true); this.accumulator = 0; this.transition("running"); }
  stop(): void { this.alive(); this.invalidateLoad(); this.resetSession(); this.restore(); this.resize(); this.transition(this.current ? "editing" : "empty", true); }
  unload(): void { this.alive(); this.invalidateLoad(); this.resetSession(); this.release(this.current); this.current = null; this.authored = null; this.propertyValues = {}; this.transition("empty", true); }
  exportProject(): ProjectDocument { this.bundle(); return structuredClone(this.authored!); }
  configure(changes: Partial<SceneSettings>): void { this.writable(); const bundle = this.bundle(), next = { ...bundle.settings, ...structuredClone(changes) }; validateSettings(next); this.applySettings(bundle, next); if (this.status === "editing") this.authored!.settings = next; this.resize(); }
  resize(): void {
    if (this.status === "disposed") return;
    if (this.canvas && this.current) this.engine.setHardwareScalingLevel(1 / (Math.min(window.devicePixelRatio || 1, this.current.settings.maxDevicePixelRatio) * this.current.settings.resolutionScale));
    this.engine.resize();
  }
  /** Consumes wall-clock seconds; drops excess catch-up beyond four fixed ticks. */
  advance(seconds: number): void {
    if (this.status !== "running" || !this.current) return;
    this.accumulator = Math.min(this.accumulator + Math.max(0, seconds), 4 / 60);
    while (this.accumulator + 1e-10 >= 1 / 60 && this.status === "running") {
      const epoch = this.sessionEpoch;
      this.accumulator -= 1 / 60;
      this.input.sample();
      if (this.status !== "running" || epoch !== this.sessionEpoch) break;
      const next = { delta: 1 / 60, tick: this.time.tick + 1, elapsed: (this.time.tick + 1) / 60 };
      for (const update of [...this.updates]) {
        if (epoch !== this.sessionEpoch) break;
        if (!this.updates.has(update) || this.status !== "running") continue;
        try { update({ ...next }); } catch (error) { this.fail(new EngineError("CALLBACK_ERROR", error instanceof Error ? error.message : String(error))); }
      }
      if (this.status !== "running" || epoch !== this.sessionEpoch) break;
      const bundle = this.current;
      this.gameplay.beforeStep(1 / 60);
      if (this.status !== "running" || epoch !== this.sessionEpoch) break;
      bundle.plugin.executeStep(1 / 60, (bundle.scene.getPhysicsEngine() as PhysicsEngine).getBodies());
      this.time = next; bundle.world.flushEvents();
      if (this.status !== "running" || epoch !== this.sessionEpoch) break;
      this.gameplay.afterStep();
      if (this.status !== "running" || epoch !== this.sessionEpoch) break;
      this.events.emit("tick", this.clock);
    }
  }
  on<K extends keyof EngineEvents>(type: K, listener: (event: EngineEvents[K]) => void, options?: { scope?: "runtime" | "session" }): () => void { this.alive(); return this.events.on(type, listener, options?.scope === "session"); }
  onUpdate(listener: (clock: ClockSnapshot) => void): () => void { this.alive(); this.updates.add(listener); return () => this.updates.delete(listener); }
  dispatch<C extends EngineCommand>(command: C): C extends { type: "spawn" } ? string : C extends { type: "destroy" } ? boolean : void {
    this.writable(); let result: string | boolean | void = undefined;
    switch (command.type) {
      case "spawn": result = this.world.spawn(command.options); break;
      case "update": this.world.update(command.id, command.changes); break;
      case "destroy": result = this.world.destroy(command.id); break;
      case "move": this.transforms.move(command.id, command.displacement, command.space); break;
      case "impulse": this.physics.applyImpulse(command.id, command.impulse); break;
      case "velocity": this.physics.setVelocity(command.id, command.velocity); break;
      case "camera": this.cameras.set(command.settings); break;
      case "interact": if (!command.actorId) throw new EngineError("INVALID_ARGUMENT", "Interaction requires an actor ID."); this.interactions.interact(command.actorId, command.id); break;
      default: throw new EngineError("INVALID_ARGUMENT", "Unknown command.");
    }
    return result as C extends { type: "spawn" } ? string : C extends { type: "destroy" } ? boolean : void;
  }
  private release(bundle: Bundle | null): void { if (!bundle) return; bundle.presence?.dispose(); bundle.tools?.dispose(); bundle.cameras.dispose(); bundle.world.dispose(); bundle.shadow?.dispose(); bundle.assets.dispose(); bundle.scene.dispose(); }
  dispose(): void {
    if (this.status === "disposed") return;
    this.invalidateLoad(); this.resetSession(); this.engine.stopRenderLoop(this.render); this.input.dispose(); this.release(this.current); this.current = null; this.authored = null; this.propertyValues = {}; this.engine.dispose(); this.transition("disposed", true); this.events.clear();
  }
}
export async function createRuntime({ canvas, havokWasmUrl, signal, limits }: RuntimeOptions): Promise<GameRuntime> {
  cancelled(signal);
  const havok = await abortable(loadHavok(havokWasmUrl), signal, () => {}); cancelled(signal);
  const engine = new Engine(canvas, true);
  try { return new Runtime(engine, havok, canvas, limits); } catch (error) { engine.dispose(); throw error; }
}
