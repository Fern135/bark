export type EntityId = string;
export type Vec3 = { x: number; y: number; z: number };
export type Quaternion = Vec3 & { w: number };
export type PrimitiveShape = "box" | "sphere" | "capsule";
export interface Transform { position: Vec3; rotation: Quaternion; scale: Vec3 }
export type Visual = { kind: PrimitiveShape; size: Vec3; materialId?: string; color?: string } | { kind: "model"; assetId: string; materialId?: string };
export interface Collider { shape: PrimitiveShape; size: Vec3; trigger: boolean; membership: number; mask: number }
export interface PhysicsSettings { mode: "static" | "dynamic" | "kinematic"; gravityEnabled: boolean; mass: number; restitution: number; friction: number; rotationLocked: boolean }
export interface EntityDefinition {
  id: EntityId; name: string; tags: string[]; enabled: boolean; visible: boolean; parentId: EntityId | null;
  transform: Transform; visual: Visual | null; collider: Collider | null; body: PhysicsSettings | null;
  properties?: PropertyMap; character?: CharacterSettings | null; interaction?: InteractionSettings | null;
}
export interface EntitySnapshot extends EntityDefinition { worldTransform: Transform; effectiveEnabled: boolean }
export interface SpawnOptions {
  id?: EntityId; name?: string; tags?: string[]; enabled?: boolean; visible?: boolean; parentId?: EntityId | null;
  transform?: Partial<Transform>; visual?: Visual | null; collider?: Partial<Collider> | null; body?: Partial<PhysicsSettings> | null;
  properties?: PropertyMap; character?: Partial<CharacterSettings> | null; interaction?: Partial<InteractionSettings> | null;
}
export type EntityChanges = Omit<SpawnOptions, "id">;
export interface AssetDefinition { id: string; type: "model" | "texture"; url: string }
export interface MaterialDefinition { id: string; color: string; textureId?: string }
export interface PrefabDefinition { id: string; entities: EntityDefinition[] }
export interface SceneSettings { background: string; ambientIntensity: number; sunIntensity: number; shadows: boolean; resolutionScale: number; maxDevicePixelRatio: number; gravity: Vec3 }
export interface CameraSettings { active: "editor" | "follow"; targetId: EntityId | null; target: Vec3; offset: Vec3; fieldOfView: number }
export interface CameraPose { position: Vec3; target: Vec3 }
export interface EditorPeer { id: string; color: string; camera?: CameraPose; selected?: string | null; preview?: { id: string; transform: Transform } | null }
/** Bindings use KeyboardEvent.code or Mouse0/Mouse1/Mouse2. */
export type InputBindings = Record<string, string[]>;
export interface ProjectDocument {
  version: 1; name: string; settings: SceneSettings; entities: EntityDefinition[]; assets: AssetDefinition[];
  materials: MaterialDefinition[]; prefabs: PrefabDefinition[]; cameras: CameraSettings; input: InputBindings;
  properties?: PropertyMap;
}
export type RuntimeState = "empty" | "loading" | "editing" | "running" | "paused" | "error" | "disposed";
export type ErrorCode = "INVALID_ARGUMENT" | "NOT_FOUND" | "INVALID_STATE" | "ASSET_LOAD" | "CANCELLED" | "DISPOSED" | "CALLBACK_ERROR" | "LIMIT_EXCEEDED";
export interface ClockSnapshot { elapsed: number; tick: number; delta: number }
export interface ActionState { pressed: boolean; held: boolean; released: boolean }
export interface QueryOptions { excludeId?: EntityId; includeTriggers?: boolean; mask?: number; membership?: number }
export interface SpatialHit { entityId: EntityId; point: Vec3; normal: Vec3; distance: number }
export interface EngineEvents {
  editorSelection: { entityId: EntityId | null };
  editorTransform: { phase: "preview" | "commit" | "cancel"; entityId: EntityId; before: Transform; transform: Transform; label: string };
  state: { previous: RuntimeState; state: RuntimeState };
  error: { code: ErrorCode; message: string };
  entity: { action: "created" | "updated" | "destroyed"; entityId: EntityId };
  input: { action: string; state: ActionState };
  interaction: { entityId: EntityId; actorId?: EntityId };
  collision: { phase: "start" | "end"; a: EntityId; b: EntityId };
  trigger: { phase: "enter" | "exit"; a: EntityId; b: EntityId };
  tick: ClockSnapshot;
  property: { entityId: EntityId | null; key: string; previous: JsonValue | undefined; value: JsonValue | undefined };
  target: { actorId: EntityId; targetId: EntityId | null };
  respawn: { entityId: EntityId; pose: Pose };
  motion: ActionResult & { actionId: string; entityId: EntityId };
  feedback: FeedbackSnapshot;
}
export interface World {
  spawn(options: SpawnOptions): EntityId;
  spawnPrefab(prefabId: string, position?: Vec3): EntityId;
  update(id: EntityId, changes: EntityChanges): void;
  get(id: EntityId): EntitySnapshot;
  list(filter?: { tag?: string; type?: Visual["kind"] | "group" }): EntitySnapshot[];
  children(id: EntityId, recursive?: boolean): EntitySnapshot[];
  destroy(id: EntityId): boolean;
}
export interface TransformAPI {
  set(id: EntityId, transform: Partial<Transform>, space?: "local" | "world"): void;
  move(id: EntityId, displacement: Vec3, space?: "local" | "world"): void;
  reparent(id: EntityId, parentId: EntityId | null, preserveWorld?: boolean): void;
  lookAt(id: EntityId, target: Vec3): void;
  forward(id: EntityId): Vec3;
  toWorld(id: EntityId, point: Vec3): Vec3;
  toLocal(id: EntityId, point: Vec3): Vec3;
}
export interface PhysicsAPI {
  velocity(id: EntityId): Vec3;
  setVelocity(id: EntityId, velocity: Vec3): void;
  applyImpulse(id: EntityId, impulse: Vec3): void;
  raycast(from: Vec3, to: Vec3, options?: QueryOptions): SpatialHit | null;
  overlap(shape: PrimitiveShape, size: Vec3, transform: Transform, options?: QueryOptions): SpatialHit | null;
  grounded(id: EntityId, distance?: number): boolean;
}
export type EngineCommand =
  | { type: "spawn"; options: SpawnOptions } | { type: "update"; id: EntityId; changes: EntityChanges }
  | { type: "destroy"; id: EntityId } | { type: "move"; id: EntityId; displacement: Vec3; space?: "local" | "world" }
  | { type: "impulse"; id: EntityId; impulse: Vec3 } | { type: "velocity"; id: EntityId; velocity: Vec3 }
  | { type: "camera"; settings: Partial<CameraSettings> } | { type: "interact"; id: EntityId; actorId?: EntityId };
export interface RuntimeOptions { canvas: HTMLCanvasElement; havokWasmUrl: string; signal?: AbortSignal; limits?: Partial<RuntimeLimits> }
export interface GameRuntime {
  readonly editorTools: EditorToolsAPI;
  readonly state: RuntimeState; readonly world: World; readonly transforms: TransformAPI; readonly physics: PhysicsAPI;
  readonly clock: ClockSnapshot;
  readonly settings: SceneSettings;
  readonly input: { action(name: string): ActionState; pointer(): { x: number; y: number }; bindings(): InputBindings };
  readonly cameras: { get(): CameraSettings; pose(): CameraPose; project(point: Vec3): { x: number; y: number; visible: boolean }; set(settings: Partial<CameraSettings>): void; frame(id?: EntityId, padding?: number): void; forward(): Vec3; ray(x: number, y: number): { from: Vec3; to: Vec3 } };
  readonly assets: { list(): AssetDefinition[] };
  readonly characters: CharacterAPI; readonly interactions: InteractionAPI; readonly properties: PropertiesAPI;
  readonly motion: MotionAPI; readonly feedback: FeedbackAPI; readonly placement: PlacementAPI;
  load(project: unknown, options?: { signal?: AbortSignal }): Promise<void>;
  unload(): void; play(): void; pause(): void; resume(): void; stop(): void; dispose(): void; resize(): void;
  exportProject(): ProjectDocument;
  configure(settings: Partial<SceneSettings>): void;
  dispatch<C extends EngineCommand>(command: C): C extends { type: "spawn" } ? EntityId : C extends { type: "destroy" } ? boolean : void;
  on<K extends keyof EngineEvents>(type: K, listener: (event: EngineEvents[K]) => void, options?: { scope?: "runtime" | "session" }): () => void;
  onUpdate(listener: (clock: ClockSnapshot) => void): () => void;
}

export type EditorTool = "select" | "move" | "resize" | "rotate";
export interface EditorToolOptions {
  enabled: boolean; selected: EntityId | null; tool: EditorTool; space: "world" | "local";
  snapping: boolean; moveSnap: number; resizeSnap: number; rotateSnap: number;
}
export interface EditorToolsAPI {
  presence(peers: EditorPeer[]): void;
  configure(options: Partial<EditorToolOptions>): void;
  get(): EditorToolOptions;
  cancel(): void;
}

export type JsonValue = null | boolean | string | number | JsonValue[] | { [key: string]: JsonValue };
export type PropertyMap = Record<string, JsonValue>;
export interface Pose { position: Vec3; rotation: Quaternion }
export interface CharacterSettings { speed: number; jumpSpeed: number; slopeLimit: number; spawn: Pose }
export interface InteractionSettings { enabled: boolean; prompt: string; distance: number }
export interface CharacterAPI {
  move(id: EntityId, direction: Vec3): void; jump(id: EntityId): boolean;
  teleport(id: EntityId, pose: Partial<Pose>): void; setSpawn(id: EntityId, pose: Pose): void; respawn(id: EntityId): void;
  get(id: EntityId): { grounded: boolean; velocity: Vec3; spawn: Pose };
}
export interface InteractionAPI { target(actorId: EntityId): EntityId | null; interact(actorId: EntityId, targetId?: EntityId): boolean }
/** null identifies world properties; entity IDs identify entity properties. */
export interface PropertiesAPI {
  get(entityId: EntityId | null, key: string): JsonValue | undefined; list(entityId: EntityId | null): PropertyMap;
  set(entityId: EntityId | null, key: string, value: JsonValue): void; remove(entityId: EntityId | null, key: string): boolean;
}
export interface RuntimeLimits { entities: number; actions: number; notifications: number }
export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";
export type ActionResult = { status: "completed" | "cancelled" | "failed"; reason?: string };
export interface ActionHandle { id: string; cancel(): void; done: Promise<ActionResult> }
export interface MotionAPI {
  glideTo(id: EntityId, destination: Vec3, seconds: number, easing?: Easing): ActionHandle;
  rotateTo(id: EntityId, rotation: Quaternion, seconds: number, easing?: Easing): ActionHandle;
}
export interface FeedbackSnapshot {
  hud: Record<string, { label: string; value: JsonValue }>;
  notifications: { id: string; text: string; remaining: number }[];
  prompt: { actorId: EntityId; targetId: EntityId; text: string } | null;
}
export interface FeedbackAPI {
  get(): FeedbackSnapshot; setHud(key: string, label: string, value: JsonValue): void; removeHud(key: string): void;
  notify(text: string, seconds?: number): string; dismiss(id: string): void;
}
export type PlacementSource = { primitive: PrimitiveShape } | { prefabId: string } | { duplicateId: EntityId };
export interface PlacementSnapshot { active: boolean; valid: boolean; reason: string; position: Vec3; yaw: number; grid: number; rotationSnap: number }
export interface PlacementAPI {
  begin(source: PlacementSource): void; configure(options: { grid?: number; rotationSnap?: number }): void;
  aim(from: Vec3, to: Vec3): PlacementSnapshot; rotate(steps?: number): void; get(): PlacementSnapshot;
  commit(): EntityId; cancel(): void;
}
