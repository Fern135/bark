import { pythonLanguage } from "@codemirror/lang-python";
import { compileBlocks } from "@bark/scripting/blocks";
import type { Diagnostic } from "@bark/scripting";
import type { Game } from "./use-editor";
import { choicesFor } from "./catalog";

export type ByteTip = {
  kind: "error" | "improvement" | "idea";
  message: string;
  line?: number;
  blockId?: string;
  source?: "ai";
};
export type ByteReview = { diagnostic?: Diagnostic; tips: ByteTip[] };

export function explainDiagnostic(diagnostic: Diagnostic): ByteTip {
  const message = diagnostic.message;
  const where = diagnostic.line ? ` on line ${diagnostic.line}` : "";
  let advice = "Check the highlighted code, make one small change, then try Play again.";
  if (/indent/i.test(message)) advice = "Keep the code inside the same block lined up. Use four spaces for each indentation level.";
  else if (/syntax|invalid python/i.test(message)) advice = "Check for a missing colon after if, for, while, or def, and make sure brackets and quotes are closed.";
  else if (/not defined|NameError/i.test(message)) advice = "Check the spelling of that name and make sure you create the variable before using it.";
  else if (/division by zero|ZeroDivision/i.test(message)) advice = "A number cannot be divided by zero. Check that the divisor is not zero before dividing.";
  else if (/entity|object|unknown.*id|reference/i.test(message)) advice = "Look in Scene for the object this code uses. Choose an existing object, or add it back to your world.";
  else if (/await|coroutine/i.test(message)) advice = "Bark actions that take time need await inside an async function so your world can keep updating.";
  else if (/argument|TypeError/i.test(message)) advice = "Check the values given to this action: numbers, text, and objects need to match what it expects.";
  else if (/module|import/i.test(message)) advice = "Check your import. Start with from bark import game; some desktop Python packages are unavailable in the browser.";
  return { kind: "error", line: diagnostic.line, blockId: diagnostic.blockId, message: `I found a problem${where}: ${message.slice(0, 240)} ${advice}` };
}

/** Local, read-only checks. Never execute a child's script to inspect it. */
export function reviewProject(game: Game, selected: string | null): ByteReview {
  const tips: ByteTip[] = [];
  let diagnostic: Diagnostic | undefined;
  if (game.script.language === "blocks") {
    try {
      diagnostic = compileBlocks(game.script, choicesFor(game.project)).diagnostics[0];
    } catch {
      diagnostic = { message: "These blocks could not be checked. Reconnect the last block you changed." };
    }
  } else {
    const source = game.script.source;
    const tree = pythonLanguage.parser.parse(source);
    const lineAt = (position: number) => source.slice(0, position).split("\n").length;
    tree.iterate({ enter(node) {
      if (node.type.isError && !diagnostic) {
        const line = lineAt(node.from);
        const text = source.split("\n")[line - 1]?.trim() ?? "";
        const missingColon = /^(?:async\s+def|def|if|elif|else|for|while|try|except|finally|class|with)\b/.test(text) && !text.includes(":");
        diagnostic = { line, message: missingColon ? `Missing colon (:) at the end of line ${line}.` : `Check Python syntax on line ${line}: brackets, quotes, and indentation need to match.` };
      }
      if (tips.length >= 5) return;
      const text = source.slice(node.from, node.to);
      if (node.name === "BinaryExpression" && /^\d+(?:\.\d+)?\s*(?:\/\/?|%)\s*0(?:\.0+)?$/.test(text)) {
        tips.push({ kind: "error", line: lineAt(node.from), message: `On line ${lineAt(node.from)}, ${text} divides by zero. Use a non-zero number, or check the divisor before dividing.` });
      }
      if (node.name === "CallExpression") {
        const match = /^game\.entity\(\s*(['"])([^'"]+)\1\s*\)$/.exec(text);
        if (match && !game.project.entities.some((entity) => entity.id === match[2])) {
          tips.push({ kind: "improvement", line: lineAt(node.from), message: `I can’t find “${match[2]}” in Scene. If you aren’t creating it during play, use the ID of an existing object on line ${lineAt(node.from)}.` });
        }
      }
      if (node.name === "WhileStatement" && node.node.getChild("Boolean") && source.slice(node.node.getChild("Boolean")!.from, node.node.getChild("Boolean")!.to) === "True") {
        let yields = false;
        node.node.getChild("Body")?.toTree().iterate({ enter(child) { if (["AwaitExpression", "BreakStatement", "ReturnStatement", "RaiseStatement", "YieldExpression"].includes(child.name)) yields = true; } });
        if (!yields) tips.push({ kind: "improvement", line: lineAt(node.from), message: `The forever loop on line ${lineAt(node.from)} has no await or exit. It could freeze your world. Add an awaited Bark action or a way to break out of the loop.` });
      }
      if (node.name === "Body") {
        let stopped = false;
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (stopped && child.name !== "Comment") {
            tips.push({ kind: "improvement", line: lineAt(child.from), message: `Line ${lineAt(child.from)} comes after return or raise in the same block, so it won’t run. Move it before that statement if you want it to happen.` });
            break;
          }
          if (["ReturnStatement", "RaiseStatement"].includes(child.name)) stopped = true;
        }
      }
    } });
  }
  if (diagnostic) tips.unshift(explainDiagnostic(diagnostic));
  if (tips.length) return { diagnostic, tips };

  const objects = game.project.entities.filter((entity) => !entity.tags.includes("ground"));
  const object = objects.find((entity) => entity.id === selected);
  const treasure = objects.find((entity) => entity.tags.includes("starter:gem"));
  const flag = objects.find((entity) => entity.tags.includes("starter:flag"));
  const name = object?.name ?? "your character";
  if (treasure) tips.push({ kind: "idea", message: `You already have ${treasure.name} in your world! Make it a collectible: when the player touches it, add a point and hide the treasure.` });
  if (object?.character) tips.push({ kind: "idea", message: `Let’s give ${name} a jumping challenge. Place a few platforms, then use an input event to make ${name} jump when a key is pressed.` });
  else if (object) tips.push({ kind: "idea", message: `Make ${name} part of the adventure. Add a touch event that shows a message when the player reaches it.` });
  if (flag) tips.push({ kind: "idea", message: `${flag.name} could be your finish line. Show “You made it!” when the player touches it, then try adding a timer.` });
  tips.push({ kind: "idea", message: game.script.language === "blocks" ? "Try an Events block with a message underneath it. Press Play to test one idea at a time, then build on it." : "Try a small on_start event that prints a welcome message. Then add one action and test it before adding more." });
  return { tips };
}
