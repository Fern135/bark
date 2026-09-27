import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody.js";
import { PhysicsShapeBox, PhysicsShapeSphere, PhysicsShapeCapsule, type PhysicsShape } from "@babylonjs/core/Physics/v2/physicsShape.js";
import { PhysicsMotionType, PhysicsActivationControl, PhysicsPrestepType, type IBasePhysicsCollisionEvent } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js";
import { ProximityCastResult } from "@babylonjs/core/Physics/proximityCastResult.js";
import type { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Assets } from "./assets.js";
import { Events } from "./events.js";
import { check, EngineError } from "./errors.js";
import { defineEntity, identity, validateEntities, vec, transform as validateTransform } from "./project.js";
import type { Collider, EntityChanges, EntityDefinition, EntitySnapshot, PhysicsAPI, PrimitiveShape, ProjectDocument, QueryOptions, SpawnOptions, SpatialHit, Transform, TransformAPI, Vec3, World } from "./types.js";

export const vector = (v: Vec3): Vector3 => new Vector3(v.x, v.y, v.z);
export const plain = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const quaternion = (v: Transform["rotation"]): Quaternion => new Quaternion(v.x, v.y, v.z, v.w);
const rotationMatrix = (q: Quaternion): Matrix => { const matrix = Matrix.Identity(); q.toRotationMatrix(matrix); return matrix; };
function pose(node: TransformNode, world = false): Transform {
  let p = node.position, q = node.rotationQuaternion!, s = node.scaling;
  if (world) { p = new Vector3(); q = new Quaternion(); s = new Vector3(); node.computeWorldMatrix(true).decompose(s, q, p); }
  return { position: plain(p), rotation: { ...plain(q), w: q.w }, scale: plain(s) };
}
interface Entry { definition: EntityDefinition; node: TransformNode; visual?: TransformNode; ownedMaterial?: StandardMaterial; body?: PhysicsBody; shape?: PhysicsShape }
interface Contact { type: "collision" | "trigger"; a: string; b: string; end: boolean }

export class RuntimeWorld implements World {
  private entries = new Map<string, Entry>();
  private bodies = new Map<PhysicsBody, string>();
  private contacts = new Map<string, Contact>();
  private pending: Contact[] = [];
  private disposed = false;
  private observers: (() => void)[] = [];
  beforeMutation: (id: string, changes?: EntityChanges) => void = () => {};
  private epoch = 0;
  private editorPreview: { id: string; before: Transform; cancel(): void } | null = null;
  private peerPreviews = new Map<string, Transform>();
  readonly transforms: TransformAPI;
  readonly physics: PhysicsAPI;
  constructor(private readonly scene: Scene, private readonly plugin: HavokPlugin, private readonly assets: Assets,
    private readonly events: Events, private readonly changed: () => void = () => {}, private readonly writable: () => void = () => {}, private readonly entityLimit = 2000) {
    const queue = (event: IBasePhysicsCollisionEvent) => {
      if (event.type === "COLLISION_CONTINUED") return;
      const a = this.bodies.get(event.collider), b = this.bodies.get(event.collidedAgainst);
      if (!a || !b) return;
      this.pending.push({ type: event.type.startsWith("TRIGGER") ? "trigger" : "collision", a, b, end: event.type.endsWith("EXITED") || event.type.endsWith("FINISHED") });
    };
    const collision = plugin.onCollisionObservable.add(queue), ended = plugin.onCollisionEndedObservable.add(queue), trigger = plugin.onTriggerCollisionObservable.add(queue);
    this.observers.push(() => plugin.onCollisionObservable.remove(collision), () => plugin.onCollisionEndedObservable.remove(ended), () => plugin.onTriggerCollisionObservable.remove(trigger));
    this.transforms = {
      set: (id, value, space = "local") => this.setTransform(id, value, space),
      move: (id, displacement, space = "world") => {
        vec(displacement); const e = this.find(id);
        const offset = space === "local" ? Vector3.TransformNormal(vector(displacement), rotationMatrix(quaternion(pose(e.node, true).rotation))) : vector(displacement);
        this.setTransform(id, { position: plain(vector(pose(e.node, true).position).add(offset)) }, "world");
      },
      reparent: (id, parentId, preserveWorld = true) => {
        const current = this.get(id); const next = preserveWorld ? this.localPose(current.worldTransform, parentId) : current.transform;
        this.update(id, { parentId, transform: next });
      },
      lookAt: (id, target) => {
        vec(target); const position = this.get(id).worldTransform.position;
        const direction = vector(target).subtract(vector(position)); check(direction.lengthSquared() > 1e-12, "Look-at target must differ from position.");
        const q = Quaternion.FromEulerAngles(-Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), Math.atan2(direction.x, direction.z), 0);
        this.setTransform(id, { rotation: { ...plain(q), w: q.w } }, "world");
      },
      forward: (id) => plain(Vector3.TransformNormal(Vector3.Forward(), rotationMatrix(quaternion(this.get(id).worldTransform.rotation))).normalize()),
      toWorld: (id, point) => { vec(point); return plain(Vector3.TransformCoordinates(vector(point), this.find(id).node.computeWorldMatrix(true))); },
      toLocal: (id, point) => { vec(point); return plain(Vector3.TransformCoordinates(vector(point), Matrix.Invert(this.find(id).node.computeWorldMatrix(true)))); },
    };
    this.physics = {
      velocity: (id) => plain(this.requireBody(id).body!.getLinearVelocity()),
      setVelocity: (id, velocity) => { this.writable(); vec(velocity, "Velocity"); const e = this.requireBody(id); if (e.definition.body?.mode === "dynamic") e.body!.setLinearVelocity(vector(velocity)); },
      applyImpulse: (id, impulse) => { this.writable(); vec(impulse, "Impulse"); const e = this.requireBody(id); if (e.definition.body?.mode === "dynamic") e.body!.applyImpulse(vector(impulse), e.node.getAbsolutePosition()); },
      raycast: (from, to, options) => this.raycast(from, to, options),
      overlap: (shape, size, t, options) => this.overlap(shape, size, t, options),
      grounded: (id, distance = 0.15) => {
        check(Number.isFinite(distance) && distance >= 0, "Ground distance must be nonnegative.");
        const e = this.requireBody(id), t = this.get(id).worldTransform, c = e.definition.collider!;
        const half = vector(c.size).multiply(vector(t.scale)).scale(0.5);
        const r = rotationMatrix(quaternion(t.rotation)).m;
        const height = c.shape === "sphere" ? half.y : Math.abs(r[1]) * half.x + Math.abs(r[5]) * half.y + Math.abs(r[9]) * half.z;
        const hit = this.raycast(t.position, { ...t.position, y: t.position.y - height - distance }, { excludeId: id, mask: c.mask, membership: c.membership });
        return !!hit && hit.normal.y >= 0.6;
      },
    };
  }
  private active(): void { if (this.disposed) throw new EngineError("DISPOSED", "World has been disposed."); }
  private find(id: string): Entry { this.active(); const e = this.entries.get(id); if (!e) throw new EngineError("NOT_FOUND", `Unknown entity: ${id}`); return e; }
  /** Internal identity check for work that spans synchronous user callbacks. */
  identity(id: string): object | undefined { return this.entries.get(id); }
  private requireBody(id: string): Entry { const e = this.find(id); if (!e.body) throw new EngineError("INVALID_STATE", "Entity has no enabled collider/body."); return e; }
  private effective(e: Entry): boolean { return e.definition.enabled && (!e.definition.parentId || this.effective(this.find(e.definition.parentId))); }
  private makeShape(c: Collider, scale: Vec3): PhysicsShape {
    const size = vector(c.size).multiply(vector(scale));
    const shape = c.shape === "box" ? new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), size, this.scene)
      : c.shape === "sphere" ? new PhysicsShapeSphere(Vector3.Zero(), size.x / 2, this.scene)
      : new PhysicsShapeCapsule(new Vector3(0, -(size.y - size.x) / 2, 0), new Vector3(0, (size.y - size.x) / 2, 0), size.x / 2, this.scene);
    shape.isTrigger = c.trigger; shape.filterMembershipMask = c.membership; shape.filterCollideMask = c.mask;
    return shape;
  }
  private clearBody(e: Entry): void {
    if (e.body) { this.bodies.delete(e.body); e.body.dispose(); e.body = undefined; }
    e.shape?.dispose(); e.shape = undefined;
    this.pending = this.pending.filter((c) => c.a !== e.definition.id && c.b !== e.definition.id);
    for (const [key, contact] of this.contacts) if (contact.a === e.definition.id || contact.b === e.definition.id) { this.contacts.delete(key); this.pending.push({ ...contact, end: true }); }
  }
  private buildBody(e: Entry): void {
    this.clearBody(e);
    if (!e.definition.collider || !this.effective(e)) return;
    const b = e.definition.body;
    e.node.computeWorldMatrix(true);
    e.body = new PhysicsBody(e.node, b?.mode === "dynamic" ? PhysicsMotionType.DYNAMIC : b?.mode === "kinematic" ? PhysicsMotionType.ANIMATED : PhysicsMotionType.STATIC, false, this.scene);
    e.shape = this.makeShape(e.definition.collider, e.definition.transform.scale);
    e.body.shape = e.shape; this.bodies.set(e.body, e.definition.id);
    this.configureBody(e);
    e.body.setCollisionCallbackEnabled(true); e.body.setCollisionEndedCallbackEnabled(true);
  }
  private configureBody(e: Entry): void {
    if (!e.body || !e.shape) return;
    const b = e.definition.body;
    e.shape.material = { friction: b?.friction ?? 0.5, restitution: b?.restitution ?? 0.3 };
    e.body.setMassProperties({ mass: b?.mode === "dynamic" ? b.mass : 0, ...(b?.rotationLocked ? { inertia: Vector3.Zero() } : {}) });
    e.body.setGravityFactor(b?.gravityEnabled ? 1 : 0);
    if (b?.mode === "dynamic") this.plugin.setActivationControl(e.body, PhysicsActivationControl.ALWAYS_ACTIVE);
  }
  private buildVisual(e: Entry): void {
    e.visual?.dispose(); e.ownedMaterial?.dispose(); e.ownedMaterial = undefined;
    const v = e.definition.visual; if (!v) { e.visual = undefined; return; }
    const root = new TransformNode(`${e.definition.id}-visual`, this.scene); root.parent = e.node; e.visual = root;
    if (v.kind === "model") {
      const container = this.assets.models.get(v.assetId); if (!container) throw new EngineError("NOT_FOUND", `Model not loaded: ${v.assetId}`);
      const instances = container.instantiateModelsToScene((name) => `${e.definition.id}:${name}`, false, { doNotInstantiate: true });
      for (const node of instances.rootNodes) node.parent = root;
      root.onDisposeObservable.add(() => { for (const skeleton of instances.skeletons) skeleton.dispose(); for (const animation of instances.animationGroups) animation.dispose(); });
    } else {
      const mesh = v.kind === "box" ? CreateBox("box", { width: v.size.x, height: v.size.y, depth: v.size.z }, this.scene)
        : v.kind === "sphere" ? CreateSphere("sphere", { diameterX: v.size.x, diameterY: v.size.y, diameterZ: v.size.z, segments: 24 }, this.scene)
        : CreateCapsule("capsule", { height: v.size.y, radius: v.size.x / 2 }, this.scene);
      mesh.parent = root;
      if (v.kind === "capsule") mesh.scaling.z = v.size.z / v.size.x;
    }
    let material = v.materialId ? this.assets.materials.get(v.materialId) : undefined;
    if (!material && v.kind !== "model") {
      material = new StandardMaterial(`${e.definition.id}-material`, this.scene); material.diffuseColor = Color3.FromHexString(v.color ?? "#8ED6A3"); material.specularColor = new Color3(0.1, 0.1, 0.1); e.ownedMaterial = material;
    }
    for (const mesh of root.getChildMeshes()) { if (material) mesh.material = material; mesh.receiveShadows = true; mesh.isVisible = e.definition.visible; mesh.metadata = { entityId: e.definition.id }; }
  }
  private place(e: Entry): void {
    const t = e.definition.transform;
    e.node.position.copyFrom(vector(t.position)); e.node.rotationQuaternion = quaternion(t.rotation); e.node.scaling.copyFrom(vector(t.scale));
    e.node.parent = e.definition.parentId ? this.find(e.definition.parentId).node : null;
    e.node.setEnabled(e.definition.enabled); e.node.computeWorldMatrix(true);
  }
  private add(definition: EntityDefinition): Entry {
    const e: Entry = { definition: structuredClone(definition), node: new TransformNode(definition.id, this.scene) };
    e.node.rotationQuaternion = Quaternion.Identity(); this.entries.set(definition.id, e); return e;
  }
  replace(definitions: EntityDefinition[]): void {
    this.checkCapacity(definitions.length, true);
    validateEntities(definitions, this.assets.project);
    this.clear();
    for (const d of definitions) this.add(d);
    for (const e of this.entries.values()) { this.place(e); this.buildVisual(e); }
    for (const e of this.entries.values()) this.buildBody(e);
    this.changed();
  }
  definitions(): EntityDefinition[] { this.active(); return [...this.entries.values()].map((e) => ({ ...structuredClone(e.definition), transform: this.editorPreview?.id === e.definition.id ? structuredClone(this.editorPreview.before) : structuredClone(this.peerPreviews.get(e.definition.id) ?? pose(e.node)) })); }
  /** Remote gestures affect rendered nodes only, just like a local gizmo preview. */
  previewPeers(previews: { id: string; transform: Transform }[]): void {
    for (const [id, before] of this.peerPreviews) {
      const entry = this.entries.get(id);
      if (entry) { entry.node.position.copyFrom(vector(before.position)); entry.node.rotationQuaternion = quaternion(before.rotation); entry.node.scaling.copyFrom(vector(before.scale)); entry.node.computeWorldMatrix(true); }
    }
    this.peerPreviews.clear();
    if (this.scene.physicsEnabled) return;
    for (const { id, transform } of previews) {
      const entry = this.entries.get(id);
      if (!entry || this.editorPreview?.id === id || this.peerPreviews.has(id)) continue;
      try { validateTransform(transform); } catch { continue; }
      this.peerPreviews.set(id, pose(entry.node));
      entry.node.position.copyFrom(vector(transform.position)); entry.node.rotationQuaternion = quaternion(transform.rotation); entry.node.scaling.copyFrom(vector(transform.scale)); entry.node.computeWorldMatrix(true);
    }
  }
  /** Editor-only presentation transaction. Physics and authored definitions change only on commit. */
  beginEditorTransform(id: string) {
    this.previewPeers([]);
    const e = this.find(id), before = pose(e.node);
    check(!this.editorPreview && !this.scene.physicsEnabled, "Transform preview requires an idle editing world.");
    let closed = false;
    const restore = () => {
      if (closed) return;
      closed = true; this.editorPreview = null;
      if (this.entries.get(id) !== e) return;
      e.node.position.copyFrom(vector(before.position)); e.node.rotationQuaternion = quaternion(before.rotation); e.node.scaling.copyFrom(vector(before.scale)); e.node.computeWorldMatrix(true);
    };
    this.editorPreview = { id, before, cancel: restore };
    return {
      before,
      preview: (world: Transform): Transform => {
        check(!closed && this.entries.get(id) === e, "Transform preview has ended.");
        const local = this.localPose(world, e.definition.parentId);
        validateEntities(this.definitions().map((d) => d.id === id ? { ...d, transform: local } : d), this.assets.project);
        e.node.position.copyFrom(vector(local.position)); e.node.rotationQuaternion = quaternion(local.rotation); e.node.scaling.copyFrom(vector(local.scale)); e.node.computeWorldMatrix(true);
        return local;
      },
      cancel: restore,
      commit: () => { if (closed) return before; const next = pose(e.node); restore(); this.transforms.set(id, next); return next; },
    };
  }
  /** Visible subtree bounds expressed in the selected entity's unscaled local space. */
  editorBounds(id: string): { min: Vector3; max: Vector3 } {
    const e = this.find(id), inverse = Matrix.Invert(e.node.computeWorldMatrix(true));
    let min = new Vector3(Infinity, Infinity, Infinity), max = min.negate();
    for (const mesh of e.node.getChildMeshes()) {
      if (!mesh.isEnabled() || !mesh.isVisible || !mesh.getTotalVertices()) continue;
      mesh.computeWorldMatrix(true);
      for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
        const point = Vector3.TransformCoordinates(corner, inverse);
        min = Vector3.Minimize(min, point); max = Vector3.Maximize(max, point);
      }
    }
    return Number.isFinite(min.x) ? { min, max } : { min: new Vector3(-0.5, -0.5, -0.5), max: new Vector3(0.5, 0.5, 0.5) };
  }
  get(id: string): EntitySnapshot { const e = this.find(id); return { ...structuredClone(e.definition), transform: pose(e.node), worldTransform: pose(e.node, true), effectiveEnabled: this.effective(e) }; }
  list(filter?: { tag?: string; type?: "box" | "sphere" | "capsule" | "model" | "group" }): EntitySnapshot[] {
    this.active(); return [...this.entries.keys()].map((id) => this.get(id)).filter((e) => (!filter?.tag || e.tags.includes(filter.tag)) && (!filter?.type || (e.visual?.kind ?? "group") === filter.type));
  }
  children(id: string, recursive = false): EntitySnapshot[] { this.find(id); const direct = this.list().filter((e) => e.parentId === id); return recursive ? direct.flatMap((e) => [e, ...this.children(e.id, true)]) : direct; }
  spawn(options: SpawnOptions): string {
    this.checkCapacity(1);
    this.active(); this.writable(); const d = defineEntity(options);
    validateEntities([...this.definitions(), d], this.assets.project);
    const e = this.add(d);
    try { this.place(e); this.buildVisual(e); this.buildBody(e); } catch (error) { this.release(e); this.entries.delete(d.id); throw error; }
    this.changed(); this.events.emit("entity", { action: "created", entityId: d.id }); return d.id;
  }
  spawnPrefab(prefabId: string, position?: Vec3): string {
    this.writable(); const prefab = this.assets.project.prefabs.find((p) => p.id === prefabId);
    if (!prefab) throw new EngineError("NOT_FOUND", `Unknown prefab ${prefabId}.`);
    if (position) vec(position);
    this.checkCapacity(prefab.entities.length);
    const ids = new Map(prefab.entities.map((e) => [e.id, crypto.randomUUID()]));
    const copies = prefab.entities.map((e) => ({ ...structuredClone(e), id: ids.get(e.id)!, parentId: e.parentId ? ids.get(e.parentId)! : null }));
    const root = copies.find((e) => !e.parentId)!; if (position) root.transform.position = { ...position };
    return this.insertSubtree(copies);
  }
  update(id: string, changes: EntityChanges): void {
    this.previewPeers([]);
    this.editorPreview?.cancel();
    this.writable(); const e = this.find(id), current = this.get(id);
    const next = defineEntity({ ...current, ...changes, id, transform: { ...current.transform, ...changes.transform },
      collider: changes.collider === null ? null : changes.collider ? { ...current.collider, ...changes.collider } : current.collider,
      body: changes.body === null ? null : changes.body ? { ...current.body, ...changes.body } : current.body,
      character: changes.character === null ? null : changes.character ? { ...current.character, ...changes.character } : current.character,
      interaction: changes.interaction === null ? null : changes.interaction ? { ...current.interaction, ...changes.interaction } : current.interaction });
    validateEntities(this.definitions().map((d) => d.id === id ? next : d), this.assets.project);
    this.beforeMutation(id, changes);
    if (this.entries.get(id) !== e || this.disposed) return;
    const rebuild = !!changes.transform || changes.parentId !== undefined || JSON.stringify(next.collider) !== JSON.stringify(current.collider) || next.body?.mode !== current.body?.mode || next.body?.rotationLocked !== current.body?.rotationLocked || next.enabled !== current.enabled;
    e.definition = next; this.place(e);
    if (JSON.stringify(next.visual) !== JSON.stringify(current.visual)) this.buildVisual(e);
    if (rebuild) this.buildBody(e); else this.configureBody(e);
    for (const mesh of e.visual?.getChildMeshes() ?? []) mesh.isVisible = next.visible;
    this.changed(); this.events.emit("entity", { action: "updated", entityId: id }); this.flushEvents();
  }
  destroy(id: string): boolean {
    this.active(); this.writable(); if (!this.entries.has(id)) return false;
    const original = this.find(id), epoch = this.epoch;
    const children = this.children(id).map((child) => this.find(child.id));
    const current = () => !this.disposed && this.epoch === epoch && this.entries.get(id) === original;
    this.beforeMutation(id);
    if (!current()) return false;
    for (const child of children) {
      if (this.entries.get(child.definition.id) === child && child.definition.parentId === id) this.destroy(child.definition.id);
      if (!current()) return false;
    }
    // A listener may have added or replaced a child. Keep its parent intact.
    if (this.children(id).length) return false;
    this.release(original); this.entries.delete(id);
    this.changed(); this.events.emit("entity", { action: "destroyed", entityId: id }); this.flushEvents(); return true;
  }
  private localPose(t: Transform, parentId: string | null): Transform {
    if (!parentId) return structuredClone(t);
    const local = Matrix.Compose(vector(t.scale), quaternion(t.rotation), vector(t.position)).multiply(Matrix.Invert(this.find(parentId).node.computeWorldMatrix(true)));
    const s = new Vector3(), q = new Quaternion(), p = new Vector3(); check(local.decompose(s, q, p), "Transform cannot be decomposed.");
    const rebuilt = Matrix.Compose(s, q, p); check([...local.m].every((v, i) => Math.abs(v - rebuilt.m[i]) < 1e-4), "Transform would introduce shear.");
    return { position: plain(p), rotation: { ...plain(q), w: q.w }, scale: plain(s) };
  }
  private setTransform(id: string, changes: Partial<Transform>, space: "local" | "world"): void {
    this.previewPeers([]);
    const e = this.get(id); const t = { ...(space === "world" ? e.worldTransform : e.transform), ...changes }; validateTransform(t);
    this.update(id, { transform: space === "world" ? this.localPose(t, e.parentId) : t });
  }
  private raycast(from: Vec3, to: Vec3, options: QueryOptions = {}): SpatialHit | null {
    this.active(); vec(from); vec(to);
    this.validateQuery(options);
    const engine = this.scene.getPhysicsEngine()!;
    const result = engine.raycast(vector(from), vector(to), { ignoreBody: options.excludeId ? this.find(options.excludeId).body : undefined, shouldHitTriggers: options.includeTriggers ?? false, collideWith: options.mask ?? 0xffffffff, membership: options.membership ?? 0xffffffff });
    const id = result.body ? this.bodies.get(result.body) : undefined;
    return result.hasHit && id ? { entityId: id, point: plain(result.hitPointWorld), normal: plain(result.hitNormalWorld), distance: result.hitDistance } : null;
  }
  private overlap(kind: PrimitiveShape, size: Vec3, t: Transform, options: QueryOptions = {}): SpatialHit | null {
    this.active(); validateTransform(t);
    this.validateQuery(options);
    const c: Collider = { shape: kind, size, trigger: false, membership: options.membership ?? 0xffffffff, mask: options.mask ?? 0xffffffff };
    validateEntities([defineEntity({ id: "query", collider: c, transform: t })], this.assets.project);
    const shape = this.makeShape(c, t.scale), a = new ProximityCastResult(), b = new ProximityCastResult();
    try {
      this.plugin.shapeProximity({ shape, position: vector(t.position), rotation: quaternion(t.rotation), maxDistance: 0, shouldHitTriggers: options.includeTriggers ?? false, ignoreBody: options.excludeId ? this.find(options.excludeId).body : undefined }, a, b);
      const id = b.body ? this.bodies.get(b.body) : undefined;
      return b.hasHit && id ? { entityId: id, point: plain(b.hitPoint), normal: plain(b.hitNormal), distance: b.hitDistance } : null;
    } finally { shape.dispose(); }
  }
  private validateQuery(options: QueryOptions): void {
    for (const n of [options.membership, options.mask]) if (n !== undefined) check(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, "Query filters must be unsigned 32-bit integers.");
  }
  flushEvents(): void {
    const queue = this.pending, epoch = this.epoch; this.pending = [];
    for (const contact of queue) {
      if (epoch !== this.epoch || this.disposed) break;
      const key = JSON.stringify([contact.type, ...[contact.a, contact.b].sort()]);
      if (contact.end) this.contacts.delete(key);
      else { if (!this.entries.has(contact.a) || !this.entries.has(contact.b) || this.contacts.has(key)) continue; this.contacts.set(key, contact); }
      if (contact.type === "trigger") this.events.emit("trigger", { phase: contact.end ? "exit" : "enter", a: contact.a, b: contact.b });
      else this.events.emit("collision", { phase: contact.end ? "end" : "start", a: contact.a, b: contact.b });
    }
  }
  private release(e: Entry): void { this.clearBody(e); e.visual?.dispose(); e.ownedMaterial?.dispose(); e.node.dispose(); }
  private clear(): void { this.peerPreviews.clear(); this.epoch++; for (const e of this.entries.values()) e.node.parent = null; for (const e of this.entries.values()) this.release(e); this.entries.clear(); this.contacts.clear(); this.pending = []; }
  checkCapacity(count: number, replace = false): void { if ((replace ? 0 : this.entries.size) + count > this.entityLimit) throw new EngineError("LIMIT_EXCEEDED", `Entity limit is ${this.entityLimit}.`); }
  /** Internal continuous pose update; never changes authored data or rebuilds a body. */
  drive(id: string, position: Vec3, rotation: Transform["rotation"]): void {
    const e = this.find(id);
    if (e.body && e.definition.body?.mode === "kinematic") e.body.setTargetTransform(vector(position), quaternion(rotation));
    else {
      const local = this.localPose({ ...this.get(id).worldTransform, position, rotation }, e.definition.parentId);
      e.node.position.copyFrom(vector(local.position)); e.node.rotationQuaternion!.copyFrom(quaternion(local.rotation)); e.node.computeWorldMatrix(true);
      if (e.body) {
        const previous = e.body.getPrestepType(); e.body.setPrestepType(PhysicsPrestepType.TELEPORT);
        try { this.plugin.setPhysicsBodyTransformation(e.body, e.node); } finally { e.body.setPrestepType(previous); }
      }
    }
  }
  stopDrive(id: string): void { const e = this.find(id); if (e.body && e.definition.body?.mode === "kinematic") { e.body.setLinearVelocity(Vector3.Zero()); e.body.setAngularVelocity(Vector3.Zero()); } }
  preview(definitions: EntityDefinition[]): { roots: TransformNode[]; meshes: import("@babylonjs/core/Meshes/abstractMesh.js").AbstractMesh[]; dispose(): void } {
    const entries = definitions.map((d) => ({ definition: structuredClone(d), node: new TransformNode(`preview:${d.id}`, this.scene) } as Entry));
    for (const e of entries) {
      const t = e.definition.transform; e.node.position.copyFrom(vector(t.position)); e.node.rotationQuaternion = quaternion(t.rotation); e.node.scaling.copyFrom(vector(t.scale));
      e.node.parent = entries.find((p) => p.definition.id === e.definition.parentId)?.node ?? null; this.buildVisual(e);
    }
    return { roots: entries.filter((e) => !e.node.parent).map((e) => e.node), meshes: entries.flatMap((e) => e.visual?.getChildMeshes() ?? []), dispose: () => { for (const e of entries) { e.visual?.dispose(); e.ownedMaterial?.dispose(); e.node.dispose(); } } };
  }
  insertSubtree(definitions: EntityDefinition[]): string {
    this.writable(); this.checkCapacity(definitions.length); validateEntities([...this.definitions(), ...definitions], this.assets.project);
    const added: Entry[] = [];
    try {
      for (const d of definitions) added.push(this.add(d));
      for (const e of added) { this.place(e); this.buildVisual(e); this.buildBody(e); }
    } catch (error) { for (const e of added.reverse()) { this.release(e); this.entries.delete(e.definition.id); } throw error; }
    this.changed(); const epoch = this.epoch;
    for (const e of added) { if (this.epoch !== epoch || this.disposed) break; this.events.emit("entity", { action: "created", entityId: e.definition.id }); }
    return definitions.find((e) => !e.parentId)!.id;
  }
  dispose(): void { if (this.disposed) return; for (const remove of this.observers) remove(); this.clear(); this.disposed = true; }
}
