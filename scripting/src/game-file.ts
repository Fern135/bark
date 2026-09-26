import { EngineError, validateProject } from "@bark/engine";
import type { AssetDefinition, ProjectDocument } from "@bark/engine";
import { compilePython, validateDocument } from "./document.js";
import type { Compilation, Diagnostic, GameDocument } from "./types.js";
import type { BlockChoices } from "./blocks.js";

export type GameFile = GameDocument<ProjectDocument>;
export interface GameFileOptions { baseUrl?: string; signal?: AbortSignal }
export class GameFileError extends Error {
  constructor(message: string, readonly diagnostics: Diagnostic[] = []) {
    super(message); this.name = "GameFileError";
  }
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new EngineError("CANCELLED", "Game operation cancelled.");
}
export function choicesFor(project: ProjectDocument): BlockChoices {
  return {
    entities: project.entities.map((e) => [e.name, e.id]),
    prefabs: project.prefabs.map((p) => [p.id, p.id]),
    actions: Object.keys(project.input).map((a) => [a, a]),
    properties: Object.fromEntries([
      ["", Object.keys(project.properties ?? {})],
      ...project.entities.map((e) => [e.id, Object.keys(e.properties ?? {})]),
    ]),
  };
}
export async function compileGame(game: GameFile): Promise<Compilation> {
  const script = game.script;
  const workspace = script.language === "blocks" ? script.workspace : script.blocksBackup;
  if (workspace) {
    const { compileBlocks, validateBlockReferences } = await import("./blocks.js");
    const choices = choicesFor(game.project);
    const diagnostics = validateBlockReferences(workspace, choices);
    if (diagnostics.length) throw new GameFileError(diagnostics[0].message, diagnostics);
    const result = compileBlocks({ language: "blocks", workspace }, choices);
    if (result.diagnostics.length) throw new GameFileError(result.diagnostics[0].message, result.diagnostics);
    if (script.language === "blocks") return result;
  }
  return compilePython(script);
}
function assetUrl(asset: AssetDefinition, baseUrl?: string): string {
  let url: URL;
  try { url = baseUrl ? new URL(asset.url, baseUrl) : new URL(asset.url); }
  catch { throw new GameFileError(`Asset "${asset.id}" needs an explicit baseUrl for its relative URL. Re-export from Script Lab for a portable file.`); }
  if (!["http:", "https:", "data:", "blob:"].includes(url.protocol))
    throw new GameFileError(`Asset "${asset.id}" uses an unsupported URL scheme.`);
  return url.href;
}

// Inspect the bytes, not the server's content-type (static servers often return octet-stream).
function assetMime(bytes: Uint8Array, type: AssetDefinition["type"]): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "model") {
    if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a)
      throw new Error("Expected a GLB 2.0 model.");
    let offset = 12;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error("Truncated GLB chunk.");
      const length = view.getUint32(offset, true);
      if (length % 4 || offset + 8 + length > bytes.length) throw new Error("Invalid GLB chunk length.");
      offset += 8 + length;
    }
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
      if (item.uri && !item.uri.startsWith("data:")) throw new Error("GLB buffers and images must be embedded.");
    if (json.extensionsUsed?.some((e: string) => ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"].includes(e)))
      throw new Error("Compressed GLB models are not supported.");
    return "model/gltf-binary";
  }
  if (bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) {
    let offset = 8, first = true, pixels = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), tag = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
      if (offset + 12 + length > bytes.length) break;
      if (first && (tag !== "IHDR" || length !== 13 || !view.getUint32(offset + 8) || !view.getUint32(offset + 12))) break;
      first = false;
      if (tag === "IDAT") pixels = true;
      offset += 12 + length;
      if (tag === "IEND" && length === 0 && pixels && offset === bytes.length) return "image/png";
    }
    throw new Error("Invalid or truncated PNG texture.");
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2, frame = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194].includes(marker)) frame = length >= 8 && view.getUint16(offset + 3) > 0 && view.getUint16(offset + 5) > 0;
      if (marker === 218 && frame && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return "image/jpeg";
      offset += length;
    }
  }
  throw new Error("Expected a PNG or JPEG texture.");
}
async function readAsset(asset: AssetDefinition, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
  checkCancelled(signal);
  try {
    const response = await fetch(asset.url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    checkCancelled(signal);
    return { bytes, mime: assetMime(bytes, asset.type) };
  } catch (error) {
    checkCancelled(signal);
    throw new GameFileError(`Asset "${asset.id}": ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function normalize(value: unknown, options: GameFileOptions): Promise<GameFile> {
  checkCancelled(options.signal);
  const document = validateDocument(value);
  const project = validateProject(document.project);
  const game: GameFile = { ...document, project };
  for (const asset of project.assets) asset.url = assetUrl(asset, options.baseUrl);
  await compileGame(game);
  checkCancelled(options.signal);
  return game;
}
/** Validates embedded bytes without requesting external assets or executing Python. */
export async function parseGame(json: string, options: GameFileOptions = {}): Promise<GameFile> {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new GameFileError("Expected valid game JSON."); }
  const game = await normalize(value, options);
  const checked = new Set<string>();
  for (const asset of game.project.assets) {
    const key = `${asset.type}:${asset.url}`;
    if (asset.url.startsWith("data:") && !checked.has(key)) {
      await readAsset(asset, options.signal); checked.add(key);
    }
  }
  checkCancelled(options.signal);
  return game;
}
/** Captures the document synchronously, then packages all declared assets. */
export async function serializeGame(document: GameDocument, options: GameFileOptions = {}): Promise<string> {
  const game = await normalize(structuredClone(document), options);
  const cache = new Map<string, { bytes: Uint8Array; mime: string; type: AssetDefinition["type"] }>();
  for (const asset of game.project.assets) {
    let loaded = cache.get(asset.url);
    if (!loaded) { loaded = { ...await readAsset(asset, options.signal), type: asset.type }; cache.set(asset.url, loaded); }
    if (loaded.type !== asset.type) throw new GameFileError(`Asset "${asset.id}" declares conflicting types for the same URL.`);
    let binary = "";
    for (let i = 0; i < loaded.bytes.length; i += 0x8000)
      binary += String.fromCharCode(...loaded.bytes.subarray(i, i + 0x8000));
    asset.url = `data:${loaded.mime};base64,${btoa(binary)}`;
  }
  checkCancelled(options.signal);
  return JSON.stringify(game, null, 2);
}
