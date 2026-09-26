import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import "@babylonjs/loaders/glTF/index.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { cancelled, EngineError } from "./errors.js";
import type { ProjectDocument } from "./types.js";

function checkModel(bytes: ArrayBuffer): void {
  const data = new DataView(bytes);
  if (bytes.byteLength < 20 || data.getUint32(0, true) !== 0x46546c67 || data.getUint32(4, true) !== 2 || data.getUint32(8, true) !== bytes.byteLength || data.getUint32(16, true) !== 0x4e4f534a) throw new Error("Expected a GLB 2.0 file.");
  const jsonLength = data.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as { buffers?: { uri?: string }[]; images?: { uri?: string }[]; extensionsUsed?: string[] };
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) if (item.uri && !item.uri.startsWith("data:")) throw new Error("GLB assets must embed their buffers and images.");
  if (json.extensionsUsed?.some((extension) => ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"].includes(extension))) throw new Error("Compressed GLB assets are not supported in this foundation.");
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined, release: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let aborted = false;
    const abort = () => { aborted = true; reject(new EngineError("CANCELLED", "Operation cancelled.")); };
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    promise.then((value) => { signal?.removeEventListener("abort", abort); if (aborted) release(value); else resolve(value); }, (error: unknown) => { signal?.removeEventListener("abort", abort); if (!aborted) reject(error); });
  });
}
export class Assets {
  readonly models = new Map<string, AssetContainer>();
  readonly textures = new Map<string, Texture>();
  readonly materials = new Map<string, StandardMaterial>();
  private disposed = false;
  constructor(private readonly scene: Scene, readonly project: ProjectDocument) {}
  async load(signal?: AbortSignal): Promise<void> {
    try {
      // Cache by URL as well as ID; multiple declarations may share one resource.
      const cache = new Map<string, AssetContainer | Texture>();
      for (const asset of this.project.assets) {
        cancelled(signal);
        const key = `${asset.type}:${asset.url}`;
        let resource = cache.get(key);
        if (!resource) {
          const response = await fetch(asset.url, { signal });
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${asset.url}`);
          const bytes = await response.arrayBuffer(); cancelled(signal);
          if (asset.type === "model") {
            checkModel(bytes);
            resource = await abortable(LoadAssetContainerAsync(new Uint8Array(bytes), this.scene, { pluginExtension: ".glb" }), signal, (container) => container.dispose());
          } else {
            const url = URL.createObjectURL(new Blob([bytes], { type: response.headers.get("content-type") ?? "image/png" }));
            const loading = new Promise<Texture>((resolve, reject) => {
              let texture: Texture;
              const cleanup = () => { URL.revokeObjectURL(url); signal?.removeEventListener("abort", abort); };
              const abort = () => { cleanup(); texture?.dispose(); reject(new EngineError("CANCELLED", "Texture loading cancelled.")); };
              signal?.addEventListener("abort", abort, { once: true });
              texture = new Texture(url, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE,
                () => { cleanup(); resolve(texture); },
                (message) => { cleanup(); texture.dispose(); reject(new Error(message ?? "Texture decoding failed.")); });
            });
            resource = await abortable(loading, signal, (texture) => texture.dispose());
          }
          cache.set(key, resource);
        }
        if (asset.type === "model") this.models.set(asset.id, resource as AssetContainer);
        else this.textures.set(asset.id, resource as Texture);
      }
      for (const definition of this.project.materials) {
        const material = new StandardMaterial(definition.id, this.scene);
        material.diffuseColor = Color3.FromHexString(definition.color);
        material.specularColor = new Color3(0.1, 0.1, 0.1);
        if (definition.textureId) material.diffuseTexture = this.textures.get(definition.textureId)!;
        this.materials.set(definition.id, material);
      }
    } catch (error) {
      this.dispose();
      if (signal?.aborted) throw new EngineError("CANCELLED", "Asset loading cancelled.");
      if (error instanceof EngineError) throw error;
      throw new EngineError("ASSET_LOAD", `Asset loading failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const m of this.materials.values()) m.dispose();
    for (const t of new Set(this.textures.values())) t.dispose();
    for (const c of new Set(this.models.values())) c.dispose();
    this.materials.clear(); this.textures.clear(); this.models.clear();
  }
}
