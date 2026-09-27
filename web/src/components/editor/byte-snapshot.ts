import { compileBlocks, Blockly } from "@bark/scripting/blocks";
import { compilePython } from "@bark/scripting";
import type { ScriptDocument } from "@bark/scripting";
import type { ByteSnapshot } from "@/lib/byte-hints";
import { canonical } from "@/lib/collaboration";
import { choicesFor } from "./catalog";
import type { Game } from "./use-editor";

type SavedBlock = Record<string, unknown> & {
  id?: string;
  type?: string;
  inputs?: Record<string, { block?: SavedBlock; shadow?: SavedBlock }>;
  next?: { block?: SavedBlock };
};

function semanticBlock(block: SavedBlock): SavedBlock {
  const { x: _x, y: _y, ...rest } = block;
  void _x; void _y;
  return {
    ...rest,
    ...(block.inputs ? { inputs: Object.fromEntries(Object.entries(block.inputs).map(([key, input]) => [key, {
      ...input,
      ...(input.block ? { block: semanticBlock(input.block) } : {}),
      ...(input.shadow ? { shadow: semanticBlock(input.shadow) } : {}),
    }])) } : {}),
    ...(block.next?.block ? { next: { ...block.next, block: semanticBlock(block.next.block) } } : {}),
  };
}

export function semanticScript(script: ScriptDocument): unknown {
  if (script.language === "python") return { language: "python", source: script.source };
  const blocks = script.workspace.blocks as { blocks?: SavedBlock[] } | undefined;
  return { language: "blocks", workspace: { ...script.workspace, blocks: {
    ...blocks, blocks: blocks?.blocks?.map(semanticBlock).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  } } };
}

export function byteContext(game: Game) {
  return { ...choicesFor(game.project), tags: Object.fromEntries(game.project.entities.map((entity) => [entity.id, entity.tags])) };
}

export function byteKey(game: Game): string {
  return canonical({ script: semanticScript(game.script), context: byteContext(game) });
}

export function buildByteSnapshot(game: Game): ByteSnapshot | null {
  if (new TextEncoder().encode(byteKey(game)).length > 64 * 1024) return null;
  const choices = choicesFor(game.project);
  const compilation = game.script.language === "blocks" ? compileBlocks(game.script, choices) : compilePython(game.script);
  const blocks: ByteSnapshot["blocks"] = [];
  if (game.script.language === "blocks") {
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(game.script.workspace, workspace);
      for (const block of workspace.getAllBlocks(false)) {
        blocks.push({ id: block.id, type: block.type, label: block.toString(), fields: Object.fromEntries(block.inputList.flatMap((input) => input.fieldRow.filter((field) => field.name).map((field) => [field.name, field.getValue()]))) });
      }
    } finally { workspace.dispose(); }
  }
  if (!compilation.python.trim() && !compilation.diagnostics.length) return null;
  return { language: game.script.language, python: compilation.python, sourceMap: compilation.sourceMap, blocks, context: byteContext(game), diagnostics: compilation.diagnostics };
}
