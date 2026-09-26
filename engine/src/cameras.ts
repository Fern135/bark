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
  constructor(private readonly scene: Scene, private readonly world: World, settings: CameraSettings, private readonly canvas?: HTMLCanvasElement) {
    this.value = structuredClone(settings);
    this.editor = new ArcRotateCamera("editor", -Math.PI / 2.5, Math.PI / 3, 20, vector(settings.target), scene);
    this.editor.lowerRadiusLimit = 2; this.editor.upperRadiusLimit = 100; this.editor.upperBetaLimit = Math.PI / 2 - 0.03; this.editor.wheelPrecision = 30;
    this.follow = new FreeCamera("follow", Vector3.Zero(), scene); this.follow.minZ = 0.1;
    this.set(settings);
  }
  get(): CameraSettings { return structuredClone(this.value); }
  set(changes: Partial<CameraSettings>): void {
    const next = { ...this.value, ...structuredClone(changes) }; validateCamera(next);
    this.value = next; this.editor.fov = this.follow.fov = next.fieldOfView * Math.PI / 180;
    if (changes.target) this.editor.setTarget(vector(next.target));
    this.editor.detachControl();
    if (next.active === "editor" && this.canvas) this.editor.attachControl(this.canvas, true);
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
