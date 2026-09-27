import { compileBlocks, Blockly } from "@bark/scripting/blocks";
import { compilePython, scriptFor } from "@bark/scripting";
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

export function byteContext(game: Game, ownerId: string | null = null) {
  return { ...choicesFor(game.project), ownerId, tags: Object.fromEntries(game.project.entities.map((entity) => [entity.id, entity.tags])) };
}

export function byteKey(game: Game, ownerId: string | null = null): string {
  const script = scriptFor(game, ownerId);
  return canonical({ script: semanticScript(script), context: byteContext(game, ownerId) });
}

export function buildByteSnapshot(game: Game, ownerId: string | null = null, allowEmpty = false): ByteSnapshot | null {
  const script = scriptFor(game, ownerId);
  if (new TextEncoder().encode(byteKey(game, ownerId)).length > 64 * 1024) return null;
  const choices = { ...choicesFor(game.project), ownerId };
  const compilation = script.language === "blocks" ? compileBlocks(script, choices) : compilePython(script);
  const blocks: ByteSnapshot["blocks"] = [];
  if (script.language === "blocks") {
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(script.workspace, workspace);
      for (const block of workspace.getAllBlocks(false)) {
        blocks.push({ id: block.id, type: block.type, label: block.toString(), fields: Object.fromEntries(block.inputList.flatMap((input) => input.fieldRow.filter((field) => field.name).map((field) => [field.name, field.getValue()]))) });
      }
    } finally { workspace.dispose(); }
  }
if (!allowEmpty && !compilation.python.trim() && !compilation.diagnostics.length) return null;
return { language: script.language, python: compilation.python, sourceMap: compilation.sourceMap, blocks, context: byteContext(game, ownerId), diagnostics: compilation.diagnostics };
}
