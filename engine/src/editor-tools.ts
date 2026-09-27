import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { UtilityLayerRenderer } from "@babylonjs/core/Rendering/utilityLayerRenderer.js";
import { PositionGizmo } from "@babylonjs/core/Gizmos/positionGizmo.js";
import { RotationGizmo } from "@babylonjs/core/Gizmos/rotationGizmo.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { PointerDragBehavior } from "@babylonjs/core/Behaviors/Meshes/pointerDragBehavior.js";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import type { Cameras } from "./cameras.js";
import type { Events } from "./events.js";
import { RuntimeWorld, vector, plain } from "./world.js";
import type { EditorToolOptions, EditorToolsAPI, Transform } from "./types.js";
import { resizeTransform, snap, type Axis } from "./editor-transform.js";

const axes: Axis[] = ["x", "y", "z"];
const colors = [Color3.FromHexString("#ef6461"), Color3.FromHexString("#57b98a"), Color3.FromHexString("#5b9cf6")];
const defaults: EditorToolOptions = { enabled: false, selected: null, tool: "move", space: "world", snapping: true, moveSnap: 0.5, resizeSnap: 0.25, rotateSnap: 15 };
const rotation = (t: Transform) => new Quaternion(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);

export class EditorTools implements Omit<EditorToolsAPI, "presence"> {
  private options = { ...defaults };
  private layer: UtilityLayerRenderer;
  private proxy: TransformNode;
  private move: PositionGizmo;
  private rotate: RotationGizmo;
  private faces: { mesh: Mesh; visible: Mesh; behavior: PointerDragBehavior; axis: Axis; side: number }[] = [];
  private box: LinesMesh | null = null;
  private bounds = { min: new Vector3(-0.5, -0.5, -0.5), max: new Vector3(0.5, 0.5, 0.5) };
  private drag: { transaction: ReturnType<RuntimeWorld["beginEditorTransform"]>; start: Transform; local: Transform; id: string; distance: number; uniform: boolean } | null = null;
  private off: (() => void)[] = [];
  private pointerDown: { x: number; y: number } | null = null;
  private suppressed = false;
  private alt = false;
  private shift = false;
  private hovered: Mesh | null = null;

  constructor(private scene: Scene, private world: RuntimeWorld, private cameras: Cameras, private events: Events, private editing: () => boolean, private canvas?: HTMLCanvasElement) {
    this.layer = new UtilityLayerRenderer(scene);
    this.layer.utilityLayerScene.autoClearDepthAndStencil = true;
    this.proxy = new TransformNode("editor-transform-proxy", this.layer.utilityLayerScene);
    this.proxy.rotationQuaternion = Quaternion.Identity();
    this.move = new PositionGizmo(this.layer, 2.5);
    this.move.planarGizmoEnabled = true;
    this.move.scaleRatio = 1.3;
    this.rotate = new RotationGizmo(this.layer, 48, false, 2.5);
    this.rotate.scaleRatio = 1.45;
    for (const [i, axis] of axes.entries()) {
      const moveAxis = this.move[`${axis}Gizmo`];
      for (const gizmo of [moveAxis, this.move[`${axis}PlaneGizmo`], this.rotate[`${axis}Gizmo`]]) {
        gizmo.dragBehavior.dragButtons = [0];
        gizmo.dragBehavior.detachCameraControls = false;
        gizmo.coloredMaterial.disableLighting = true; gizmo.coloredMaterial.emissiveColor = colors[i];
        gizmo.hoverMaterial.disableLighting = true; gizmo.hoverMaterial.emissiveColor = Color3.White();
      }
      this.move[`${axis}PlaneGizmo`].coloredMaterial.alpha = 0.35;
      for (const side of [-1, 1]) {
        const mesh = CreateSphere(`editor-resize-${axis}-${side}`, { diameter: 1, segments: 12 }, this.layer.utilityLayerScene);
        const material = new StandardMaterial(`editor-handle-${axis}-${side}`, this.layer.utilityLayerScene);
        material.disableLighting = true; material.emissiveColor = colors[i]; material.alpha = 0;
        mesh.material = material;
        const visible = CreateSphere(`editor-resize-dot-${axis}-${side}`, { diameter: 0.55, segments: 16 }, this.layer.utilityLayerScene);
        visible.parent = mesh; visible.isPickable = false;
        const dotMaterial = material.clone(`editor-dot-${axis}-${side}`); dotMaterial.alpha = 1; visible.material = dotMaterial;
        const direction = Vector3.Zero(); direction[axis] = 1;
        const behavior = new PointerDragBehavior({ dragAxis: direction });
        behavior.dragButtons = [0];
        behavior.moveAttached = false; behavior.detachCameraControls = false;
        mesh.addBehavior(behavior);
        behavior.onDragStartObservable.add(() => this.begin());
        behavior.onDragObservable.add((event) => {
          const drag = this.drag; if (!drag) return;
          drag.distance += event.dragDistance;
          const uniform = drag.uniform || this.shift;
          const minimum = 0.01 / (uniform ? Math.min(...Object.values(drag.transaction.before.scale)) : drag.transaction.before.scale[axis]);
          const distance = snap(drag.distance, this.options.snapping ? this.options.resizeSnap : 0);
          const next = resizeTransform(drag.start, this.bounds, axis, side, distance, uniform, this.alt, minimum);
          this.preview(next, `Size ${axes.map((a) => ((this.bounds.max[a] - this.bounds.min[a]) * next.scale[a]).toFixed(2)).join(" × ")}`);
        });
        behavior.onDragEndObservable.add(() => this.finish());
        this.faces.push({ mesh, visible, behavior, axis, side });
      }
    }
    this.move.onDragStartObservable.add(() => this.begin());
    this.move.onDragObservable.add(() => {
      if (!this.drag) return;
      const position = plain(this.proxy.position);
      this.preview({ ...this.drag.start, position }, `${vector(position).subtract(vector(this.drag.start.position)).length().toFixed(2)} units`);
    });
    this.move.onDragEndObservable.add(() => this.finish());
    this.rotate.onDragStartObservable.add(() => this.begin());
    this.rotate.onDragObservable.add(() => {
      if (!this.drag) return;
      const q = this.proxy.rotationQuaternion!.normalize();
      const axis = axes.find((a) => this.rotate[`${a}Gizmo`].dragBehavior.dragging);
      const angle = axis ? this.rotate[`${axis}Gizmo`].angle : 0;
      this.preview({ ...this.drag.start, rotation: { ...plain(q), w: q.w } }, `${(angle * 180 / Math.PI).toFixed(1)}°`);
    });
    this.rotate.onDragEndObservable.add(() => this.finish());
    const frame = scene.onBeforeRenderObservable.add(() => this.render());
    this.off.push(() => scene.onBeforeRenderObservable.remove(frame));
    const hover = this.layer.utilityLayerScene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERMOVE) this.hovered = info.pickInfo?.pickedMesh as Mesh ?? null;
    });
    this.off.push(() => this.layer.utilityLayerScene.onPointerObservable.remove(hover));
    if (canvas) {
      const down = (event: PointerEvent) => {
        this.alt = event.altKey; this.shift = event.shiftKey;
        this.layer.pickingEnabled = event.button === 0;
        if (event.button !== 0) { this.cancel(); return; }
        if (!this.active()) return;
        canvas.focus(); this.pointerDown = { x: event.clientX, y: event.clientY }; this.suppressed = false;
      };
      const up = (event: PointerEvent) => {
        const down = this.pointerDown; this.pointerDown = null;
        if (!down || !this.active() || this.suppressed || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
        const rect = canvas.getBoundingClientRect();
        const picked = scene.pick(event.clientX - rect.left, event.clientY - rect.top, (mesh) => !!mesh.metadata?.entityId && mesh.isVisible && mesh.isEnabled() && !mesh.metadata?.preview);
        const id: string | null = picked?.pickedMesh?.metadata?.entityId ?? null;
        this.configure({ selected: id }); this.events.emit("editorSelection", { entityId: id });
      };
      const keys = (event: KeyboardEvent | PointerEvent) => {
        this.alt = event.altKey; this.shift = event.shiftKey;
        if ("buttons" in event) this.layer.pickingEnabled = (event.buttons & 6) === 0;
      };
      const key = (event: KeyboardEvent) => { keys(event); if (event.key === "Escape") this.cancel(); };
      const cancel = () => this.cancel();
      const context = (event: Event) => { if (this.active()) event.preventDefault(); };
      canvas.addEventListener("pointerdown", down, true); canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointermove", keys); canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("pointerleave", cancel); canvas.addEventListener("blur", cancel); canvas.addEventListener("contextmenu", context);
      window.addEventListener("keydown", key); window.addEventListener("keyup", keys); window.addEventListener("blur", cancel);
      this.off.push(() => {
        canvas.removeEventListener("pointerdown", down, true); canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointermove", keys); canvas.removeEventListener("pointercancel", cancel); canvas.removeEventListener("pointerleave", cancel); canvas.removeEventListener("blur", cancel); canvas.removeEventListener("contextmenu", context);
        window.removeEventListener("keydown", key); window.removeEventListener("keyup", keys); window.removeEventListener("blur", cancel);
      });
    }
  }
  get(): EditorToolOptions { return { ...this.options }; }
  configure(options: Partial<EditorToolOptions>): void {
    for (const key of ["moveSnap", "resizeSnap", "rotateSnap"] as const) if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key]! <= 0)) throw new Error("Snap increments must be positive.");
    if (Object.entries(options).some(([key, value]) => this.options[key as keyof EditorToolOptions] !== value)) this.cancel();
    this.options = { ...this.options, ...options };
    this.cameras.editorControls(this.editing(), !!this.drag); this.render();
  }
  private active(): boolean { return this.options.enabled && this.editing(); }
  private begin(): void {
    if (!this.active() || !this.options.selected || this.drag) return;
    const entity = this.world.get(this.options.selected);
    this.bounds = this.world.editorBounds(entity.id);
    this.drag = { transaction: this.world.beginEditorTransform(entity.id), start: entity.worldTransform, local: entity.transform, id: entity.id, distance: 0, uniform: !!entity.character || (!!entity.collider && entity.collider.shape !== "box") || this.world.children(entity.id).length > 0 };
    this.suppressed = true; this.cameras.editorControls(true, true);
  }
  private preview(next: Transform, label: string): void {
    if (!this.drag) return;
    try {
      this.drag.local = this.drag.transaction.preview(next);
      this.events.emit("editorTransform", { phase: "preview", entityId: this.drag.id, before: this.drag.transaction.before, transform: this.drag.local, label });
    } catch (error) {
      this.events.emit("editorTransform", { phase: "preview", entityId: this.drag.id, before: this.drag.transaction.before, transform: this.drag.local, label: error instanceof Error ? error.message : "This transform is unavailable." });
    }
  }
  private finish(): void {
    const drag = this.drag; if (!drag) return; this.drag = null;
    try {
      const before = drag.transaction.before;
      if ((["position", "rotation", "scale"] as const).every((field) => Object.entries(before[field]).every(([axis, value]) => Math.abs(value - (drag.local[field] as Record<string, number>)[axis]) < 1e-6))) {
        drag.transaction.cancel(); this.events.emit("editorTransform", { phase: "cancel", entityId: drag.id, before, transform: before, label: "" }); return;
      }
      const transform = drag.transaction.commit();
      this.events.emit("editorTransform", { phase: "commit", entityId: drag.id, before: drag.transaction.before, transform, label: "" });
    } finally { this.cameras.editorControls(this.editing()); }
  }
  cancel(): void {
    const drag = this.drag; this.drag = null;
    if (drag) {
      drag.transaction.cancel(); this.move.releaseDrag(); this.rotate.releaseDrag(); this.faces.forEach((face) => face.behavior.releaseDrag());
      this.events.emit("editorTransform", { phase: "cancel", entityId: drag.id, before: drag.transaction.before, transform: drag.transaction.before, label: "" });
    }
    this.cameras.editorControls(this.editing());
  }
  private render(): void {
    const candidate = this.active() && this.options.selected && this.world.identity(this.options.selected) ? this.world.get(this.options.selected) : undefined;
    const entity = candidate?.effectiveEnabled && candidate.visible ? candidate : undefined;
    const moveNode = entity && this.options.tool === "move" ? this.proxy : null;
    const rotateNode = entity && this.options.tool === "rotate" ? this.proxy : null;
    if (this.move.attachedNode !== moveNode) this.move.attachedNode = moveNode;
    if (this.rotate.attachedNode !== rotateNode) this.rotate.attachedNode = rotateNode;
    if (!entity) { this.faces.forEach((face) => face.mesh.setEnabled(false)); this.box?.setEnabled(false); return; }
    if (!this.drag) {
      this.proxy.position.copyFrom(vector(entity.worldTransform.position)); this.proxy.rotationQuaternion = rotation(entity.worldTransform);
      this.bounds = this.world.editorBounds(entity.id);
    }
    this.move.updateGizmoRotationToMatchAttachedMesh = this.rotate.updateGizmoRotationToMatchAttachedMesh = this.options.space === "local";
    this.move.snapDistance = this.options.snapping ? this.options.moveSnap : 0;
    this.rotate.snapDistance = this.options.snapping ? this.options.rotateSnap * Math.PI / 180 : 0;
    if (this.rotate.xGizmo.isEnabled !== !entity.character) this.rotate.xGizmo.isEnabled = !entity.character;
    if (this.rotate.zGizmo.isEnabled !== !entity.character) this.rotate.zGizmo.isEnabled = !entity.character;
    const pose = entity.worldTransform, matrix = Matrix.Compose(vector(pose.scale), rotation(pose), vector(pose.position));
    const center = this.bounds.min.add(this.bounds.max).scale(0.5);
    for (const face of this.faces) {
      face.mesh.setEnabled(this.options.tool === "resize");
      const point = center.clone(); point[face.axis] = face.side > 0 ? this.bounds.max[face.axis] : this.bounds.min[face.axis];
      face.mesh.position.copyFrom(Vector3.TransformCoordinates(point, matrix)); face.mesh.rotationQuaternion = rotation(pose);
      const camera = this.scene.activeCamera;
      const size = camera ? Math.max(0.08, Vector3.Distance(camera.globalPosition, face.mesh.position) * Math.tan(camera.fov / 2) * 44 / this.scene.getEngine().getRenderHeight()) : 0.25;
      face.mesh.scaling.setAll(size);
      (face.visible.material as StandardMaterial).emissiveColor = this.hovered === face.mesh ? Color3.White() : colors[axes.indexOf(face.axis)];
    }
    const corners = Array.from({ length: 8 }, (_, i) => Vector3.TransformCoordinates(new Vector3(i & 1 ? this.bounds.max.x : this.bounds.min.x, i & 2 ? this.bounds.max.y : this.bounds.min.y, i & 4 ? this.bounds.max.z : this.bounds.min.z), matrix));
    const lines: Vector3[][] = [];
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) lines.push([corners[i], corners[i | bit]]);
    this.box = CreateLineSystem("editor-selection-bounds", { lines, updatable: true, instance: this.box ?? undefined }, this.layer.utilityLayerScene);
    this.box.color = Color3.FromHexString("#c07b4e"); this.box.alpha = 0.7; this.box.isPickable = false; this.box.setEnabled(true);
  }
  dispose(): void {
    this.cancel(); this.off.forEach((off) => off()); this.move.dispose(); this.rotate.dispose(); this.box?.dispose();
    this.faces.forEach(({ mesh }) => mesh.dispose(false, true)); this.proxy.dispose(); this.layer.dispose(); this.cameras.editorControls(false);
  }
}
