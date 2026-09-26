import type { Compilation, GameDocument, ScriptCompiler, ScriptDocument } from "./types.js";

export function validateDocument(value: unknown): GameDocument {
  if (!value || typeof value !== "object") throw new Error("Expected a Bark game document.");
  const d = value as GameDocument;
  if (d.version !== 1 || !d.project || typeof d.project !== "object" || !d.script)
    throw new Error("Unsupported or incomplete Bark game document.");
  const s = d.script;
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
  return structuredClone(d);
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
