import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { check, EngineError } from "./errors.js";
import { defineEntity, identity, validateEntities, vec } from "./project.js";
import type { RuntimeWorld } from "./world.js";
import type { EntityDefinition, PlacementAPI, PlacementSnapshot, PlacementSource, ProjectDocument, Vec3 } from "./types.js";

export class Placement implements PlacementAPI {
  private state: PlacementSnapshot = { active: false, valid: false, reason: "Choose an object", position: { x: 0, y: 0, z: 0 }, yaw: 0, grid: 1, rotationSnap: 90 };
  private definitions: EntityDefinition[] = [];
  private preview: ReturnType<RuntimeWorld["preview"]> | null = null;
  private material: StandardMaterial | null = null;
  private ray: { from: Vec3; to: Vec3 } | null = null;
  constructor(private world: () => RuntimeWorld, private scene: () => Scene, private project: () => ProjectDocument, private editing: () => void) {}
  get(): PlacementSnapshot { return structuredClone(this.state); }
  configure(options: { grid?: number; rotationSnap?: number }): void {
    this.editing(); const grid = options.grid ?? this.state.grid, rotationSnap = options.rotationSnap ?? this.state.rotationSnap;
    check(Number.isFinite(grid) && grid > 0 && grid <= 100, "Grid spacing must be between 0 and 100 meters.");
    check(Number.isFinite(rotationSnap) && rotationSnap > 0 && rotationSnap <= 180, "Rotation snap must be between 0 and 180 degrees.");
    this.state.grid = grid; this.state.rotationSnap = rotationSnap; if (this.ray) this.aim(this.ray.from, this.ray.to);
  }
  begin(source: PlacementSource): void {
    this.editing(); let definitions: EntityDefinition[];
    if ("primitive" in source) {
      check(["box", "sphere", "capsule"].includes(source.primitive), "Unknown primitive.");
      const size = { x: 1, y: source.primitive === "capsule" ? 2 : 1, z: 1 };
      definitions = [defineEntity({ name: `Placed ${source.primitive}`, visual: { kind: source.primitive, size, color: "#B8DCC7" }, collider: { shape: source.primitive, size }, body: { mode: "static" } })];
    } else if ("prefabId" in source) {
      const prefab = this.project().prefabs.find((p) => p.id === source.prefabId); if (!prefab) throw new EngineError("NOT_FOUND", "Prefab not found.");
      definitions = structuredClone(prefab.entities);
    } else {
      const selected = this.world().get(source.duplicateId);
      definitions = [selected, ...this.world().children(source.duplicateId, true)].map((e) => { const { worldTransform: _world, effectiveEnabled: _enabled, ...definition } = e; return definition; });
      definitions[0].parentId = null; definitions[0].transform = selected.worldTransform;
    }
    const root = definitions.find((e) => !e.parentId)!;
    check(!!root, "Placement requires a root."); root.transform.position = { x: 0, y: 0, z: 0 };
    check(Math.abs(root.transform.rotation.x) < 1e-6 && Math.abs(root.transform.rotation.z) < 1e-6, "Placement requires an upright root.");
    validateEntities(definitions, this.project()); this.world().checkCapacity(definitions.length);
    this.cancel(); this.definitions = definitions;
    this.state = { ...this.state, active: true, valid: false, yaw: 2 * Math.atan2(root.transform.rotation.y, root.transform.rotation.w) * 180 / Math.PI, reason: "Point at a surface" };
    try {
      this.preview = this.world().preview(definitions);
      this.material = new StandardMaterial("placement-preview", this.scene()); this.material.alpha = 0.4; this.material.disableLighting = true;
      for (const mesh of this.preview.meshes) { mesh.material = this.material; mesh.isPickable = false; mesh.receiveShadows = false; mesh.metadata = { preview: true }; }
      this.tint(false);
    } catch (error) { this.cancel(); throw error; }
  }
  rotate(steps = 1): void { this.editing(); check(Number.isInteger(steps), "Rotation steps must be an integer."); this.state.yaw = (this.state.yaw + steps * this.state.rotationSnap) % 360; if (this.ray) this.aim(this.ray.from, this.ray.to); }
  private bounds(): { min: Vector3; max: Vector3 } {
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of this.preview!.meshes) {
      mesh.computeWorldMatrix(true); const bounds = mesh.getBoundingInfo().boundingBox;
      min.minimizeInPlace(bounds.minimumWorld); max.maximizeInPlace(bounds.maximumWorld);
    }
    const root = this.preview!.roots[0], collider = this.definitions.find((e) => !e.parentId)?.collider;
    if (collider) {
      const matrix = root.computeWorldMatrix(true), half = new Vector3(collider.size.x / 2, collider.size.y / 2, collider.size.z / 2);
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        const corner = Vector3.TransformCoordinates(new Vector3(x * half.x, y * half.y, z * half.z), matrix);
        min.minimizeInPlace(corner); max.maximizeInPlace(corner);
      }
    }
    if (!Number.isFinite(min.x)) { min.set(-0.5, -0.5, -0.5); max.set(0.5, 0.5, 0.5); }
    return { min, max };
  }
  aim(from: Vec3, to: Vec3): PlacementSnapshot {
    this.editing(); vec(from); vec(to); if (!this.state.active) return this.get(); this.ray = { from: { ...from }, to: { ...to } };
    const root = this.preview!.roots[0]; root.position.setAll(0); root.rotationQuaternion = Quaternion.RotationYawPitchRoll(this.state.yaw * Math.PI / 180, 0, 0);
    const hit = this.world().physics.raycast(from, to);
    let point: Vec3, normal: Vec3;
    if (hit) { point = hit.point; normal = hit.normal; }
    else {
      const t = -from.y / (to.y - from.y);
      if (!Number.isFinite(t) || t < 0 || t > 1) { this.state.valid = false; this.state.reason = "No surface"; this.tint(false); return this.get(); }
      point = { x: from.x + (to.x - from.x) * t, y: 0, z: from.z + (to.z - from.z) * t }; normal = { x: 0, y: 1, z: 0 };
    }
    const { min, max } = this.bounds(), grid = this.state.grid;
    const snapped = new Vector3(Math.round(point.x / grid) * grid, Math.round(point.y / grid) * grid, Math.round(point.z / grid) * grid);
    const n = new Vector3(normal.x, normal.y, normal.z).normalize();
    // Snap in world space, then project back onto the hit surface before adding support offset.
    snapped.addInPlace(n.scale(Vector3.Dot(new Vector3(point.x, point.y, point.z).subtract(snapped), n)));
    const support = (n.x >= 0 ? min.x : max.x) * n.x + (n.y >= 0 ? min.y : max.y) * n.y + (n.z >= 0 ? min.z : max.z) * n.z;
    root.position.copyFrom(snapped.subtract(n.scale(support)));
    this.state.position = { x: root.position.x, y: root.position.y, z: root.position.z };
    this.state.valid = true; this.state.reason = "Click to place";
    try {
      this.world().checkCapacity(this.definitions.length);
      const bounds = this.bounds(), size = bounds.max.subtract(bounds.min), center = bounds.min.add(bounds.max).scale(0.5);
      const tolerance = 0.006; size.set(Math.max(0.001, size.x - tolerance), Math.max(0.001, size.y - tolerance), Math.max(0.001, size.z - tolerance));
      const overlap = this.world().physics.overlap("box", { x: size.x, y: size.y, z: size.z }, { ...identity(), position: { x: center.x, y: center.y, z: center.z } });
      if (overlap && overlap.distance < -0.001) { this.state.valid = false; this.state.reason = "Overlaps another object"; }
    } catch (error) { this.state.valid = false; this.state.reason = error instanceof Error ? error.message : String(error); }
    this.tint(this.state.valid); return this.get();
  }
  commit(): string {
    this.editing(); if (this.ray) this.aim(this.ray.from, this.ray.to);
    check(this.state.active && this.state.valid, this.state.reason);
    const copies = structuredClone(this.definitions), ids = new Map(copies.map((e) => [e.id, crypto.randomUUID()]));
    for (const e of copies) { e.id = ids.get(e.id)!; e.parentId = e.parentId ? ids.get(e.parentId)! : null; }
    const root = copies.find((e) => !e.parentId)!;
    root.transform.position = { ...this.state.position }; const q = this.preview!.roots[0].rotationQuaternion!;
    root.transform.rotation = { x: q.x, y: q.y, z: q.z, w: q.w };
    if (root.character) root.character.spawn = { position: { ...root.transform.position }, rotation: { ...root.transform.rotation } };
    const id = this.world().insertSubtree(copies); this.cancel(); return id;
  }
  private tint(valid: boolean): void { if (this.material) this.material.emissiveColor = Color3.FromHexString(valid ? "#70DB9C" : "#EF7D86"); }
  cancel(): void { this.preview?.dispose(); this.preview = null; this.material?.dispose(); this.material = null; this.definitions = []; this.ray = null; this.state.active = false; this.state.valid = false; this.state.reason = "Choose an object"; }
}
