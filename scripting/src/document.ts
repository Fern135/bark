import type { Compilation, GameDocument, ScriptCompiler, ScriptDocument } from "./types.js";

export function validateDocument(value: unknown): GameDocument {
  if (!value || typeof value !== "object") throw new Error("Expected a Bark game document.");
  const d = value as GameDocument;
  if (![1, 2].includes(d.version) || !d.project || typeof d.project !== "object" || !d.script)
    throw new Error("Unsupported or incomplete Bark game document.");
  validateScript(d.script);
  if (d.objectScripts !== undefined) {
    if (d.version === 1 || !d.objectScripts || typeof d.objectScripts !== "object" || Array.isArray(d.objectScripts))
      throw new Error("Invalid object scripts; object code requires document version 2.");
    const entities = (d.project as { entities?: { id: string }[] }).entities ?? [];
    for (const [id, script] of Object.entries(d.objectScripts)) {
      if (!entities.some((entity) => entity.id === id)) throw new Error(`Script owner ${id} does not exist.`);
      validateScript(script);
    }
  }
  return structuredClone(d);
}
export function validateScript(s: ScriptDocument): void {
  if (!s || typeof s !== "object") throw new Error("Invalid script.");
  if (s.language === "python") {
    if (typeof s.source !== "string") throw new Error("Python source must be text.");
    if (
      s.blocksBackup !== undefined &&
      (!s.blocksBackup || typeof s.blocksBackup !== "object" || Array.isArray(s.blocksBackup))
    )
      throw new Error("Invalid blocks backup.");
  } else if (s.language === "blocks") {
    if (!s.workspace || typeof s.workspace !== "object" || Array.isArray(s.workspace))
      throw new Error("Invalid block workspace.");
  } else throw new Error("Supported script languages are blocks and python.");
}
export function scriptFor(document: GameDocument, scriptId: string | null): ScriptDocument {
  return scriptId === null ? document.script : (Object.hasOwn(document.objectScripts ?? {}, scriptId) ? document.objectScripts![scriptId] : { language: "blocks", workspace: {} });
}
export function withScript<Project>(document: GameDocument<Project>, scriptId: string | null, script: ScriptDocument): GameDocument<Project> {
  return scriptId === null ? { ...document, version: 2, objectScripts: document.objectScripts ?? {}, script } : {
    ...document, version: 2, objectScripts: { ...document.objectScripts, [scriptId]: script },
  };
}
export function copyObjectScripts<Project>(document: GameDocument<Project>, ids: Record<string, string>): GameDocument<Project> {
  const copies = Object.entries(ids).filter(([id]) => Object.hasOwn(document.objectScripts ?? {}, id));
  if (!copies.length) return document;
  return { ...document, version: 2, objectScripts: { ...document.objectScripts,
    ...Object.fromEntries(copies.map(([from, to]) => [to, structuredClone(document.objectScripts![from])])),
  } };
}
export function compilePython(script: ScriptDocument): Compilation {
  if (script.language !== "python") throw new Error("Expected Python source.");
  return { python: script.source, sourceMap: {}, diagnostics: [] };
}
export const pythonCompiler: ScriptCompiler = { language: "python", compile: compilePython };
export function convertToPython(script: ScriptDocument, compiled: Compilation): ScriptDocument {
  if (script.language !== "blocks") return structuredClone(script);
  if (compiled.diagnostics.length) throw new Error("Fix block errors before converting.");
  return {
    language: "python",
    source: compiled.python,
    blocksBackup: structuredClone(script.workspace),
  };
}
export function restoreBlocks(script: ScriptDocument): ScriptDocument {
  if (script.language !== "python" || !script.blocksBackup)
    throw new Error("No saved block workspace.");
  return { language: "blocks", workspace: structuredClone(script.blocksBackup) };
}
