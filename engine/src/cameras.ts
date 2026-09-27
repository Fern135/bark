import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import "@babylonjs/core/Culling/ray.js";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { CameraSettings, Vec3, World } from "./types.js";
import { camera as validateCamera } from "./project.js";
import { vector, plain } from "./world.js";

export class Cameras {
  private editor: ArcRotateCamera;
  private follow: FreeCamera;
  private value: CameraSettings;
  private toolsEnabled = false;
private controlState = "";
  constructor(private readonly scene: Scene, private readonly world: World, settings: CameraSettings, private readonly canvas?: HTMLCanvasElement) {
    this.value = structuredClone(settings);
    this.editor = new ArcRotateCamera("editor", -Math.PI / 2.5, Math.PI / 3, 20, vector(settings.target), scene);
    this.editor.lowerRadiusLimit = 2; this.editor.upperRadiusLimit = 100; this.editor.upperBetaLimit = Math.PI / 2 - 0.03; this.editor.wheelPrecision = 30;
    this.editor.minZ = 0.05;
    this.follow = new FreeCamera("follow", Vector3.Zero(), scene); this.follow.minZ = 0.1;
    this.set(settings);
  }
  get(): CameraSettings { return structuredClone(this.value); }
  pose() {
    const camera = this.value.active === "follow" ? this.follow : this.editor;
    return { position: plain(camera.globalPosition), target: plain(camera.getTarget()) };
  }
  project(point: Vec3) {
    const camera = this.scene.activeCamera ?? this.editor, engine = this.scene.getEngine();
    const p = Vector3.Project(vector(point), Matrix.Identity(), this.scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    return { x: p.x / engine.getRenderWidth(), y: p.y / engine.getRenderHeight(), visible: p.z >= 0 && p.z <= 1 && p.x >= 0 && p.y >= 0 && p.x <= engine.getRenderWidth() && p.y <= engine.getRenderHeight() };
  }
  editorControls(enabled: boolean, dragging = false): void {
    const state = `${enabled}:${dragging}:${this.value.active}`;
    if (state === this.controlState) return;
    this.controlState = state;
    this.toolsEnabled = enabled;
    // Reattaching during pointerdown cancels Babylon's active mouse gesture.
    const pointers = this.editor.inputs.attached.pointers as import("@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput.js").ArcRotateCameraPointersInput;
    pointers.buttons = enabled ? [1, 2] : [0, 1, 2];
    const rotate = this.editor.movement.input.getEntry("pointer", "rotate", { modifiers: {} });
    if (rotate) rotate.button = enabled ? 2 : 0;
    this.editor.detachControl();
    if (!dragging && this.value.active === "editor" && this.canvas) {
      this.editor.movement.input.resetInputMap();
      this.editor.attachControl(true, !enabled, enabled ? 1 : 2);
      if (enabled) {
        const input = this.editor.movement.input;
        // In Babylon 9, allowing a button does not assign it an interaction.
        input.inputMap = input.inputMap.filter((entry) => entry.source !== "pointer");
        input.addEntry({ source: "pointer", button: 2, interaction: "rotate" });
        input.addEntry({ source: "pointer", button: 1, interaction: "pan" });
      }
    }
    if (dragging) {
      this.editor.inertialAlphaOffset = this.editor.inertialBetaOffset = this.editor.inertialRadiusOffset = 0;
      this.editor.inertialPanningX = this.editor.inertialPanningY = 0;
    }
  }
  /** Fit the editing camera to rendered geometry without changing authored settings. */
  frame(id?: string, padding = 1.3): void {
    if (!Number.isFinite(padding) || padding < 1) throw new Error("Camera padding must be at least 1.");
    const ids = id ? new Set([id, ...this.world.children(id, true).map((e) => e.id)]) : null;
    let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    let found = false;
    for (const mesh of this.scene.meshes) {
      if (!mesh.isEnabled() || !mesh.isVisible || !mesh.getTotalVertices() || !mesh.metadata?.entityId || (ids && !ids.has(mesh.metadata.entityId))) continue;
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bounds.minimumWorld); max = Vector3.Maximize(max, bounds.maximumWorld); found = true;
    }
    if (!found) return;
    const size = max.subtract(min), aspect = this.scene.getEngine().getAspectRatio(this.editor);
    const halfFov = Math.min(this.editor.fov / 2, Math.atan(Math.tan(this.editor.fov / 2) * aspect));
    this.editor.setTarget(min.add(max).scale(0.5));
    this.editor.radius = Math.max(1, Math.max(size.y, Math.hypot(size.x, size.z) * 0.8) / 2 / Math.tan(halfFov) * padding);
    this.editor.alpha = -Math.PI / 2.5; this.editor.beta = id ? Math.PI / 2.35 : Math.PI / 2.9;
  }
  set(changes: Partial<CameraSettings>): void {
    const next = { ...this.value, ...structuredClone(changes) }; validateCamera(next);
    this.value = next; this.editor.fov = this.follow.fov = next.fieldOfView * Math.PI / 180;
    if (changes.target) this.editor.setTarget(vector(next.target));
this.editor.detachControl(); this.controlState = ""
    this.editorControls(this.toolsEnabled);
    this.scene.activeCamera = next.active === "editor" ? this.editor : this.follow;
    this.update();
  }
  update(): void {
    if (this.value.active !== "follow") return;
    const entity = this.world.list().find((e) => e.id === this.value.targetId && e.effectiveEnabled);
    if (!entity) { this.value.targetId = null; this.set({ active: "editor" }); return; }
    const target = vector(entity.worldTransform.position);
    this.follow.position.copyFrom(target.add(vector(this.value.offset))); this.follow.setTarget(target);
  }
  forward(): Vec3 { return plain((this.scene.activeCamera ?? this.editor).getForwardRay().direction); }
  ray(x: number, y: number): { from: Vec3; to: Vec3 } {
    const engine = this.scene.getEngine();
    const scaling = engine.getHardwareScalingLevel();
    const ray = this.scene.createPickingRay((x + 1) * engine.getRenderWidth() * scaling / 2, (1 - y) * engine.getRenderHeight() * scaling / 2, Matrix.Identity(), this.scene.activeCamera, false);
    return { from: plain(ray.origin), to: plain(ray.origin.add(ray.direction.scale(1000))) };
  }
  dispose(): void { this.editor.detachControl(); this.editor.dispose(); this.follow.dispose(); }
}
