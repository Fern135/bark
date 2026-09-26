import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { EngineError, check } from "./errors.js";
import { identity, jsonValue, transform, vec } from "./project.js";
import { vector, type RuntimeWorld } from "./world.js";
import type { Events } from "./events.js";
import type { ActionHandle, ActionResult, CharacterAPI, Easing, EntityChanges, FeedbackAPI, FeedbackSnapshot, InteractionAPI, MotionAPI, Pose, PropertiesAPI, PropertyMap, RuntimeLimits, RuntimeState, Vec3 } from "./types.js";

interface Motion {
  id: string; entityId: string; start: Pose; end: Pose; elapsed: number; duration: number; easing: Easing;
  settle: (result: ActionResult) => void;
}
const emptyFeedback = (): FeedbackSnapshot => ({ hud: {}, notifications: [], prompt: null });
export class Gameplay {
  private intents = new Map<string, Vec3>();
  private jumps = new Set<string>();
  private airborne = new Set<string>();
  private targets = new Map<string, string | null>();
  private motions = new Map<string, Motion>();
  private completed: Motion[] = [];
  private state = emptyFeedback();
  private epoch = 0;
  readonly characters: CharacterAPI;
  readonly interactions: InteractionAPI;
  readonly properties: PropertiesAPI;
  readonly feedback: FeedbackAPI;
  readonly motion: MotionAPI;
  constructor(private world: () => RuntimeWorld, private events: Events, private mode: () => RuntimeState,
    private writable: () => void, private worldProperties: () => PropertyMap, private saveProperties: (value: PropertyMap) => void,
    private limits: RuntimeLimits) {
    this.characters = {
      move: (id, direction) => { this.running(); this.character(id); vec(direction); this.intents.set(id, { ...direction }); },
      jump: (id) => { this.running(); this.character(id); if (this.airborne.has(id) || !this.grounded(id)) return false; this.jumps.add(id); this.airborne.add(id); return true; },
      teleport: (id, value) => { this.writable(); this.character(id); this.world().transforms.set(id, value, "world"); this.intents.delete(id); this.jumps.delete(id); this.airborne.delete(id); },
      setSpawn: (id, pose) => { this.writable(); const e = this.character(id); transform({ ...pose, scale: identity().scale }); this.world().update(id, { character: { ...e.character!, spawn: structuredClone(pose) } }); },
      respawn: (id) => { const e = this.character(id); const pose = structuredClone(e.character!.spawn); this.characters.teleport(id, pose); this.events.emit("respawn", { entityId: id, pose }); },
      get: (id) => { const e = this.character(id); return { grounded: this.grounded(id), velocity: e.effectiveEnabled ? this.world().physics.velocity(id) : { x: 0, y: 0, z: 0 }, spawn: structuredClone(e.character!.spawn) }; },
    };
    this.interactions = {
      target: (actorId) => this.target(actorId),
      interact: (actorId, targetId) => {
        this.running(); const target = this.target(actorId);
        if (!target || (targetId !== undefined && target !== targetId)) return false;
        this.events.emit("interaction", { actorId, entityId: target }); return true;
      },
    };
    this.properties = {
      list: (id) => structuredClone(id === null ? this.worldProperties() : this.world().get(id).properties ?? {}),
      get: (id, key) => { const values = this.properties.list(id); return Object.hasOwn(values, key) ? structuredClone(values[key]) : undefined; },
      set: (id, key, value) => {
        this.writable(); check(typeof key === "string" && key.length > 0, "Property key cannot be empty."); jsonValue(value);
        const values = this.properties.list(id), previous = Object.hasOwn(values, key) ? values[key] : undefined;
        if (JSON.stringify(previous) === JSON.stringify(value)) return;
        Object.defineProperty(values, key, { value: structuredClone(value), enumerable: true, configurable: true, writable: true });
        if (id === null) this.saveProperties(values); else this.world().update(id, { properties: values });
        this.events.emit("property", { entityId: id, key, previous, value: structuredClone(value) });
      },
      remove: (id, key) => { this.writable(); const values = this.properties.list(id); if (!Object.hasOwn(values, key)) return false;
        const previous = values[key]; delete values[key]; if (id === null) this.saveProperties(values); else this.world().update(id, { properties: values });
        this.events.emit("property", { entityId: id, key, previous, value: undefined }); return true; },
    };
    this.feedback = {
      get: () => structuredClone(this.state),
      setHud: (key, label, value) => { this.session(); check(typeof key === "string" && key.length > 0 && typeof label === "string", "HUD requires a key and label."); jsonValue(value); Object.defineProperty(this.state.hud, key, { value: { label, value: structuredClone(value) }, enumerable: true, configurable: true, writable: true }); this.publish(); },
      removeHud: (key) => { this.session(); delete this.state.hud[key]; this.publish(); },
      notify: (text, seconds = 3) => { this.session(); check(typeof text === "string" && Number.isFinite(seconds) && seconds > 0, "Notification requires text and a positive duration.");
        if (this.state.notifications.length >= this.limits.notifications) throw new EngineError("LIMIT_EXCEEDED", "Notification limit reached.");
        const id = crypto.randomUUID(); this.state.notifications.push({ id, text, remaining: seconds }); this.publish(); return id; },
      dismiss: (id) => { this.session(); this.state.notifications = this.state.notifications.filter((n) => n.id !== id); this.publish(); },
    };
    this.motion = {
      glideTo: (id, position, seconds, easing = "linear") => { vec(position); return this.start(id, { position }, seconds, easing); },
      rotateTo: (id, rotation, seconds, easing = "linear") => { transform({ ...identity(), rotation }); return this.start(id, { rotation }, seconds, easing); },
    };
  }
  private running(): void { this.writable(); if (this.mode() !== "running") throw new EngineError("INVALID_STATE", "This action requires Play."); }
  private session(): void { this.writable(); if (!["running", "paused"].includes(this.mode())) throw new EngineError("INVALID_STATE", "Feedback requires a play session."); }
  private character(id: string) { const e = this.world().get(id); if (!e.character) throw new EngineError("INVALID_ARGUMENT", `${id} is not a character.`); return e; }
  private grounded(id: string): boolean {
    const e = this.character(id); if (!e.effectiveEnabled) return false;
    const c = e.collider!, p = e.worldTransform.position, s = e.worldTransform.scale.x;
    const radius = c.size.x * s * 0.3, bottom = c.size.y * s / 2;
    return [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]].some(([x, z]) => {
      const start = { x: p.x + x, y: p.y - bottom + 0.2, z: p.z + z };
      const hit = this.world().physics.raycast(start, { ...start, y: start.y - 0.3 }, { excludeId: id, mask: c.mask });
      return !!hit && hit.normal.y >= Math.cos(e.character!.slopeLimit * Math.PI / 180);
    });
  }
  private target(actorId: string): string | null {
    const world = this.world(), actor = world.get(actorId); if (!actor.effectiveEnabled) return null;
    const candidates = world.list().filter((e) => e.interaction?.enabled && e.effectiveEnabled && e.visible);
    const distance = Math.max(0, ...candidates.map((e) => e.interaction!.distance)); if (!distance) return null;
    const start = actor.worldTransform.position, direction = world.transforms.forward(actorId);
    const hit = world.physics.raycast(start, { x: start.x + direction.x * distance, y: start.y + direction.y * distance, z: start.z + direction.z * distance }, { excludeId: actorId });
    const target = hit && candidates.find((e) => e.id === hit.entityId);
    return target && hit.distance <= target.interaction!.distance ? target.id : null;
  }
  private start(id: string, destination: Partial<Pose>, seconds: number, easing: Easing): ActionHandle {
    this.running(); check(Number.isFinite(seconds) && seconds > 0, "Motion duration must be positive."); check(["linear", "easeIn", "easeOut", "easeInOut"].includes(easing), "Unknown easing.");
    const entity = this.world().get(id); check(entity.effectiveEnabled && !entity.character && (!entity.collider || entity.body?.mode === "kinematic"), "Motion requires an enabled collider-free entity or kinematic body.");
    if (!this.motions.has(id) && this.motions.size >= this.limits.actions) throw new EngineError("LIMIT_EXCEEDED", "Timed action limit reached.");
    this.cancel(id, "replaced");
    let settle!: (result: ActionResult) => void;
    const done = new Promise<ActionResult>((resolve) => { settle = resolve; });
    const start = { position: entity.worldTransform.position, rotation: entity.worldTransform.rotation };
    const action: Motion = { id: crypto.randomUUID(), entityId: id, start, end: structuredClone({ ...start, ...destination }), duration: seconds, elapsed: 0, easing, settle };
    this.motions.set(id, action);
    return { id: action.id, done, cancel: () => { if (this.motions.get(id) === action) this.cancel(id, "cancelled by caller"); } };
  }
  private finish(action: Motion, result: ActionResult, emit = true): void {
    if (this.motions.get(action.entityId) !== action) return;
    this.motions.delete(action.entityId);
    if (this.world().list().some((e) => e.id === action.entityId)) this.world().stopDrive(action.entityId);
    action.settle(result); if (emit) this.events.emit("motion", { ...result, actionId: action.id, entityId: action.entityId });
  }
  private cancel(id: string, reason: string): void { const action = this.motions.get(id); if (action) this.finish(action, { status: "cancelled", reason }); }
  mutation(id: string, changes?: EntityChanges): void {
    if (!changes || changes.transform || changes.parentId !== undefined || changes.collider !== undefined || changes.body === null || (changes.body?.mode !== undefined && changes.body.mode !== "kinematic") || changes.body?.rotationLocked !== undefined || changes.character !== undefined || changes.enabled === false) {
      const world = this.world(), children = world.children(id, true);
      this.cancel(id, "entity changed"); this.intents.delete(id); this.jumps.delete(id); this.airborne.delete(id);
      for (const child of children) {
        if (!["editing", "running", "paused"].includes(this.mode()) || this.world() !== world) break;
        this.cancel(child.id, "ancestor changed");
      }
    }
  }
  beforeStep(delta: number): void {
    const epoch = this.epoch;
    for (const e of this.world().list().filter((e) => e.character && e.effectiveEnabled)) {
      const intent = this.intents.get(e.id) ?? { x: 0, y: 0, z: 0 }, length = Math.max(1, Math.hypot(intent.x, intent.z));
      const velocity = this.world().physics.velocity(e.id);
      if (!this.jumps.has(e.id) && velocity.y <= 0.1 && this.grounded(e.id)) this.airborne.delete(e.id);
      if (this.jumps.delete(e.id)) velocity.y = e.character!.jumpSpeed;
      const x = intent.x / length * e.character!.speed, z = intent.z / length * e.character!.speed;
      if (Math.hypot(x, z) > 1e-5) {
        const yaw = Math.atan2(x, z) / 2;
        this.world().drive(e.id, e.worldTransform.position, { x: 0, y: Math.sin(yaw), z: 0, w: Math.cos(yaw) });
      }
      this.world().physics.setVelocity(e.id, { x, y: velocity.y, z });
    }
    this.intents.clear();
    for (const action of [...this.motions.values()]) {
      if (epoch !== this.epoch) return;
      try {
        action.elapsed = Math.min(action.duration, action.elapsed + delta); const t = action.elapsed / action.duration;
        const amount = action.easing === "easeIn" ? t * t : action.easing === "easeOut" ? t * (2 - t) : action.easing === "easeInOut" ? t * t * (3 - 2 * t) : t;
        const p = Vector3.Lerp(vector(action.start.position), vector(action.end.position), amount);
        const a = action.start.rotation, b = action.end.rotation;
        const q = Quaternion.Slerp(new Quaternion(a.x, a.y, a.z, a.w), new Quaternion(b.x, b.y, b.z, b.w), amount);
        this.world().drive(action.entityId, { x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
        if (t >= 1) this.completed.push(action);
      } catch (error) { this.finish(action, { status: "failed", reason: String(error) }); }
    }
    const previous = this.state.notifications.length;
    this.state.notifications = this.state.notifications.map((n) => ({ ...n, remaining: Math.max(0, n.remaining - delta) })).filter((n) => n.remaining > 0);
    if (previous !== this.state.notifications.length) this.publish();
  }
  afterStep(): void {
    const epoch = this.epoch;
    const completed = this.completed; this.completed = [];
    for (const action of completed) { if (epoch !== this.epoch) return; this.finish(action, { status: "completed" }); }
    if (epoch !== this.epoch) return;
    const characters = this.world().list().filter((e) => e.character);
    for (const e of characters) {
      if (epoch !== this.epoch) return;
      const target = this.target(e.id);
      if (this.targets.get(e.id) !== target) {
        this.targets.set(e.id, target);
        this.events.emit("target", { actorId: e.id, targetId: target });
      }
    }
    if (epoch !== this.epoch) return;
    for (const id of [...this.targets.keys()]) if (!characters.some((e) => e.id === id)) {
      this.targets.delete(id); this.events.emit("target", { actorId: id, targetId: null }); if (epoch !== this.epoch) return;
    }
    const primary = this.world().list().find((e) => e.character && e.effectiveEnabled), target = primary ? this.target(primary.id) : null;
    const prompt = primary && target ? { actorId: primary.id, targetId: target, text: this.world().get(target).interaction!.prompt } : null;
    if (JSON.stringify(prompt) !== JSON.stringify(this.state.prompt)) { this.state.prompt = prompt; this.publish(); }
  }
  clearIntents(): void { this.intents.clear(); this.jumps.clear(); }
  reset(): void {
    this.epoch++; const motions = [...this.motions.values()]; this.completed = [];
    for (const action of motions) this.finish(action, { status: "cancelled", reason: "session ended" }, false);
    this.clearIntents(); this.airborne.clear(); this.targets.clear(); this.state = emptyFeedback(); this.publish();
  }
  private publish(): void { this.events.emit("feedback", this.feedback.get()); }
}
