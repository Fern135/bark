import type { Scene } from "@babylonjs/core/scene.js";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder.js";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { vector, type RuntimeWorld } from "./world.js";
import type { EditorPeer, Transform } from "./types.js";

/** Presentation meshes only: never entities, colliders, pick targets, or exports. */
export class EditorPresence {
  private meshes = new Map<string, LinesMesh>();
  constructor(private scene: Scene, private world: RuntimeWorld) {}
  set(peers: EditorPeer[]) {
    this.world.previewPeers(peers.flatMap((peer) => peer.preview ? [peer.preview] : []));
    const alive = new Set<string>();
    const draw = (id: string, lines: Vector3[][], color: string) => {
      alive.add(id);
      let mesh = this.meshes.get(id);
      mesh = CreateLineSystem(`presence:${id}`, { lines, updatable: true, instance: mesh }, this.scene);
      mesh.color = Color3.FromHexString(color); mesh.isPickable = false;
      mesh.metadata = { preview: true }; mesh.alwaysSelectAsActiveMesh = true;
      this.meshes.set(id, mesh);
    };
    for (const peer of peers) {
      if (peer.camera) {
        const origin = vector(peer.camera.position), forward = vector(peer.camera.target).subtract(origin).normalize();
        const right = Vector3.Cross(Math.abs(forward.y) > 0.98 ? Vector3.Forward() : Vector3.Up(), forward).normalize().scale(0.4);
        const up = Vector3.Cross(forward, right).normalize().scale(0.28), center = origin.add(forward.scale(0.8));
        const corners = [center.add(right).add(up), center.subtract(right).add(up), center.subtract(right).subtract(up), center.add(right).subtract(up)];
        draw(`${peer.id}:camera`, [...corners.map((corner) => [origin, corner]), [...corners, corners[0]]], peer.color);
      }
      const id = peer.preview?.id ?? peer.selected;
      if (id && this.world.list().some((entity) => entity.id === id)) {
        const entity = this.world.get(id), bounds = this.world.editorBounds(id);
        const pose = peer.preview?.transform ?? entity.transform;
        const matrix = (t: Transform) => Matrix.Compose(vector(t.scale), new Quaternion(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w), vector(t.position));
        const transform = entity.parentId ? matrix(pose).multiply(matrix(this.world.get(entity.parentId).worldTransform)) : matrix(pose);
        const corners = Array.from({ length: 8 }, (_, i) => Vector3.TransformCoordinates(new Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z), transform));
        const edges: Vector3[][] = [];
        for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) edges.push([corners[i], corners[i | bit]]);
        draw(`${peer.id}:selection`, edges, peer.color);
      }
    }
    for (const [id, mesh] of this.meshes) if (!alive.has(id)) { mesh.dispose(); this.meshes.delete(id); }
  }
  dispose() { this.world.previewPeers([]); for (const mesh of this.meshes.values()) mesh.dispose(); this.meshes.clear(); }
}
