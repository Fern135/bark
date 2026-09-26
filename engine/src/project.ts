import { check, EngineError } from "./errors.js";
import type { CameraSettings, EntityDefinition, ProjectDocument, SceneSettings, SpawnOptions, Transform, Vec3 } from "./types.js";

export const identity = (): Transform => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
export function vec(value: Vec3, label = "Vector", positive = false): void {
  check(value && [value.x, value.y, value.z].every((n) => Number.isFinite(n) && (!positive || n > 0)), `${label} must contain ${positive ? "positive " : ""}finite XYZ values.`);
}
export function uniform(v: Vec3): boolean { return Math.abs(v.x - v.y) < 1e-6 && Math.abs(v.x - v.z) < 1e-6; }
function color(value: string): void { check(typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value), "Color must use #RRGGBB."); }
function range(n: number, min: number, max: number, label: string): void { check(Number.isFinite(n) && n >= min && n <= max, `${label} must be between ${min} and ${max}.`); }
export function transform(value: Transform): void {
  vec(value.position, "Position"); vec(value.scale, "Scale", true); vec(value.rotation, "Rotation");
  check(Number.isFinite(value.rotation.w) && Math.abs(Math.hypot(value.rotation.x, value.rotation.y, value.rotation.z, value.rotation.w) - 1) < 0.001, "Rotation must be a unit quaternion.");
}
export function defineEntity(options: SpawnOptions): EntityDefinition {
  if (options.properties !== undefined) propertyMap(options.properties);
  const base = identity();
  const collider = options.collider ? { shape: "box" as const, size: { x: 1, y: 1, z: 1 }, trigger: false, membership: 1, mask: 0xffffffff, ...options.collider } : null;
  return structuredClone({
    id: options.id ?? crypto.randomUUID(), name: options.name ?? "Entity", tags: options.tags ?? [], enabled: options.enabled ?? true,
    visible: options.visible ?? true, parentId: options.parentId ?? null, transform: { ...base, ...options.transform }, visual: options.visual ?? null, collider,
    body: options.body ? { mode: "dynamic", gravityEnabled: true, mass: 1, restitution: 0.3, friction: 0.5, rotationLocked: false, ...options.body } : null,
    properties: options.properties ?? {},
    character: options.character ? { speed: 5, jumpSpeed: 6, slopeLimit: 50, spawn: { position: options.transform?.position ?? base.position, rotation: options.transform?.rotation ?? base.rotation }, ...options.character } : null,
    interaction: options.interaction ? { enabled: true, prompt: "Interact", distance: 3, ...options.interaction } : null,
  });
}
export function createProject(name = "Untitled world"): ProjectDocument {
  return {
    version: 1, name, entities: [], assets: [], materials: [], prefabs: [], properties: {},
    settings: { background: "#101D19", ambientIntensity: 0.8, sunIntensity: 1.5, shadows: true, resolutionScale: 1, maxDevicePixelRatio: 2, gravity: { x: 0, y: -9.81, z: 0 } },
    cameras: { active: "editor", targetId: null, target: { x: 0, y: 1, z: 0 }, offset: { x: 0, y: 5, z: -9 }, fieldOfView: 60 },
    input: { forward: ["KeyW", "ArrowUp"], backward: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], jump: ["Space"], interact: ["KeyE"], primary: ["Mouse0"] },
  };
}
export function settings(value: SceneSettings): void {
  color(value.background); vec(value.gravity, "Gravity");
  range(value.ambientIntensity, 0, 10, "Ambient intensity"); range(value.sunIntensity, 0, 10, "Sun intensity");
  range(value.resolutionScale, 0.25, 2, "Resolution scale"); range(value.maxDevicePixelRatio, 1, 4, "Pixel ratio cap");
  check(typeof value.shadows === "boolean", "Shadows must be a boolean.");
}
export function camera(value: CameraSettings): void {
  check(value.active === "editor" || value.active === "follow", "Unknown camera mode.");
  check(value.targetId === null || typeof value.targetId === "string", "Invalid camera target ID.");
  vec(value.target); vec(value.offset); check(Math.hypot(value.offset.x, value.offset.y, value.offset.z) > 0, "Camera offset cannot be zero.");
  range(value.fieldOfView, 15, 120, "Field of view");
}
function unique(entries: { id: string }[], label: string): void {
  check(Array.isArray(entries), `${label} must be an array.`);
  const ids = new Set<string>();
  for (const entry of entries) { check(entry && typeof entry.id === "string" && entry.id.length > 0 && !ids.has(entry.id), `${label} contains an invalid or duplicate ID.`); ids.add(entry.id); }
}
export function validateEntities(entities: EntityDefinition[], project: Pick<ProjectDocument, "assets" | "materials">): void {
  unique(entities, "Entities");
  const lookup = new Map(entities.map((e) => [e.id, e]));
  for (const e of entities) {
    propertyMap(e.properties ?? {});
    if (e.character) {
      check(e.parentId === null && e.body?.mode === "dynamic" && e.body.rotationLocked && e.collider?.shape === "capsule" && !e.collider.trigger, "Characters require a root dynamic capsule with rotation locked.");
      check(Math.abs(e.transform.rotation.x) < 1e-6 && Math.abs(e.transform.rotation.z) < 1e-6, "Characters must stay upright.");
      range(e.character.speed, 0, 100, "Walk speed"); range(e.character.jumpSpeed, 0, 100, "Jump speed"); range(e.character.slopeLimit, 0, 80, "Slope limit");
      transform({ ...e.character.spawn, scale: identity().scale });
      check(Math.abs(e.character.spawn.rotation.x) < 1e-6 && Math.abs(e.character.spawn.rotation.z) < 1e-6, "Spawn pose must stay upright.");
    }
    if (e.interaction) { check(typeof e.interaction.enabled === "boolean" && typeof e.interaction.prompt === "string", "Invalid interaction settings."); range(e.interaction.distance, 0.01, 100, "Interaction distance"); check(!!e.collider, "Interaction requires a collider."); }
    check(typeof e.name === "string" && Array.isArray(e.tags) && e.tags.every((t) => typeof t === "string"), "Names and tags must be strings.");
    check(typeof e.enabled === "boolean" && typeof e.visible === "boolean", "Enabled and visible must be booleans.");
    transform(e.transform);
    check(e.parentId === null || lookup.has(e.parentId), `Missing parent for ${e.id}.`);
    const visited = new Set([e.id]); let parent = e.parentId;
    while (parent !== null) {
      check(!visited.has(parent), "Entity hierarchy contains a cycle."); visited.add(parent);
      const p = lookup.get(parent)!;
      check(uniform(p.transform.scale), "Parents with children require uniform scale."); parent = p.parentId;
    }
    if (e.visual) {
      const v = e.visual;
      if (v.kind === "model") check(project.assets.some((a) => a.id === v.assetId && a.type === "model"), `Missing model ${v.assetId}.`);
      else { check(["box", "sphere", "capsule"].includes(v.kind), "Unsupported visual."); vec(v.size, "Visual size", true); if (v.kind === "capsule") check(v.size.y >= v.size.x, "Capsule visual height must be at least its X diameter."); }
      if (v.materialId) check(project.materials.some((m) => m.id === v.materialId), `Missing material ${v.materialId}.`);
      if (v.kind !== "model" && v.color) color(v.color);
    }
    if (e.collider) {
      const c = e.collider;
      check(e.parentId === null, "Colliders and bodies must be root entities.");
      check(["box", "sphere", "capsule"].includes(c.shape), "Unsupported collider."); vec(c.size, "Collider size", true);
      check(typeof c.trigger === "boolean", "Trigger must be a boolean.");
      for (const n of [c.membership, c.mask]) check(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, "Collision masks must be unsigned 32-bit integers.");
      if (c.shape !== "box") check(uniform(e.transform.scale), "Sphere/capsule colliders require uniform scale.");
      if (c.shape === "sphere") check(uniform(c.size), "Sphere collider dimensions must match.");
      if (c.shape === "capsule") check(c.size.x === c.size.z && c.size.y >= c.size.x, "Capsule requires equal X/Z diameter and height >= diameter.");
    }
    if (e.body) {
      const b = e.body;
      check(e.collider && e.parentId === null, "Bodies require a root collider.");
      check(["static", "dynamic", "kinematic"].includes(b.mode), "Unknown body mode.");
      check(Number.isFinite(b.mass) && b.mass > 0, "Mass must be positive.");
      range(b.friction, 0, 1, "Friction"); range(b.restitution, 0, 1, "Bounce");
      check(typeof b.gravityEnabled === "boolean" && typeof b.rotationLocked === "boolean", "Physics flags must be booleans.");
    }
  }
}
export function validateProject(value: unknown): ProjectDocument {
  try {
    const source = value as ProjectDocument;
    if (source?.properties !== undefined) propertyMap(source.properties);
    for (const e of [...(source?.entities ?? []), ...(source?.prefabs ?? []).flatMap((p) => p.entities)]) if (e.properties !== undefined) propertyMap(e.properties);
    const p = structuredClone(value) as ProjectDocument;
    check(p && p.version === 1, "Unsupported project version; expected version 1."); check(typeof p.name === "string", "Project name must be a string.");
    unique(p.assets, "Assets"); unique(p.materials, "Materials"); unique(p.prefabs, "Prefabs");
    for (const asset of p.assets) {
      check(asset.type === "model" || asset.type === "texture", "Unsupported asset type.");
      check(typeof asset.url === "string" && asset.url.trim().length > 0 && !/^(javascript|file):/i.test(asset.url), "Asset URL must be a browser-loadable URL.");
    }
    for (const m of p.materials) { color(m.color); if (m.textureId) check(p.assets.some((a) => a.id === m.textureId && a.type === "texture"), `Missing texture ${m.textureId}.`); }
    p.properties ??= {}; propertyMap(p.properties);
    for (const e of [...p.entities, ...p.prefabs.flatMap((prefab) => prefab.entities)]) {
      e.properties ??= {}; const defaults = defineEntity(e); e.character = defaults.character; e.interaction = defaults.interaction;
    }
    validateEntities(p.entities, p);
    for (const prefab of p.prefabs) { validateEntities(prefab.entities, p); check(prefab.entities.filter((e) => e.parentId === null).length === 1, "A prefab must contain exactly one root."); }
    settings(p.settings); camera(p.cameras);
    if (p.cameras.targetId) check(p.entities.some((e) => e.id === p.cameras.targetId), "Camera target is missing.");
    check(p.input && typeof p.input === "object" && !Array.isArray(p.input), "Input bindings must be an object.");
    for (const [name, codes] of Object.entries(p.input)) check(name.length > 0 && Array.isArray(codes) && codes.every((code) => typeof code === "string" && /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Shift(Left|Right)|Control(Left|Right)|Mouse[0-2])$/.test(code)), `Invalid bindings for ${name}.`);
    return p;
  } catch (error) { if (error instanceof EngineError) throw error; throw new EngineError("INVALID_ARGUMENT", "Malformed project document.", { cause: error }); }
}

export function jsonValue(value: unknown, stack = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { check(Number.isFinite(value), "Properties require finite numbers."); return; }
  check(typeof value === "object" && value !== null, "Properties must contain JSON values.");
  const object = value as object; check(!stack.has(object), "Properties cannot contain cycles.");
  check(Array.isArray(object) || Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null, "Properties require plain objects.");
  check(Reflect.ownKeys(object).every((key) => typeof key === "string"), "Properties cannot contain symbol keys.");
  stack.add(object); for (const item of Object.values(object)) jsonValue(item, stack); stack.delete(object);
}
export function propertyMap(value: unknown): void { check(!!value && typeof value === "object" && !Array.isArray(value), "Properties must be a dictionary."); jsonValue(value); }
