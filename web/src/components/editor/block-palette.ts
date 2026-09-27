import { Blockly, toolbox } from "@bark/scripting/blocks";
import type { IconName } from "@/components/ui/icon";

export class BarkFlyout extends Blockly.VerticalFlyout {
  getWidth() {
    return this.isVisible() ? super.getWidth() : 0;
  }
  getFlyoutScale() {
    return window.innerWidth <= 1250 ? 0.66 : 0.8;
  }
}
export const paletteCategories: {
  name: string;
  label: string;
  color: string;
  icon: IconName;
}[] = [
  { name: "Events", label: "Events", color: "#F6A100", icon: "play" },
  { name: "World", label: "World", color: "#9748F5", icon: "cube" },
  { name: "Control", label: "Logic", color: "#00AC50", icon: "spark" },
  { name: "Variables", label: "Variables", color: "#FF513B", icon: "palette" },
  {
    name: "Characters & motion",
    label: "Motion",
    color: "#3189ED",
    icon: "arrow",
  },
  { name: "Sensing", label: "Sensing", color: "#42B8C4", icon: "eye" },
  {
    name: "Properties & HUD",
    label: "Properties",
    color: "#B766D7",
    icon: "code",
  },
  {
    name: "Messages & timers",
    label: "Messages",
    color: "#EBA431",
    icon: "upload",
  },
  { name: "Logic & math", label: "Math", color: "#4DAB91", icon: "plus" },
  { name: "Text & output", label: "Text", color: "#8F62D8", icon: "code" },
  { name: "Lists & text", label: "Lists", color: "#CA718F", icon: "code" },
  { name: "My Blocks", label: "My blocks", color: "#AA6AD9", icon: "cube" },
];

export function showPalette(
  ws: Blockly.WorkspaceSvg,
  name: string,
  query: string,
) {
  const selected = toolbox.contents.find((c) => c.name === name);
  if (!selected) return;
  if (!query && "custom" in selected && selected.custom) {
    const callback = ws.getToolboxCategoryCallback(selected.custom);
    if (callback) ws.getFlyout()?.show(callback(ws));
    return;
  }
  const groups = query
    ? toolbox.contents
    : name === "Events"
      ? toolbox.contents
          .filter((c) => ["Events", "World", "Control"].includes(c.name))
          .sort(
            (a, b) =>
              ["Events", "World", "Control"].indexOf(a.name) -
              ["Events", "World", "Control"].indexOf(b.name),
          )
      : [selected];
  const contents: Blockly.utils.toolbox.FlyoutItemInfo[] = [];
  const searchWorkspace = query ? new Blockly.Workspace() : undefined;
  for (const group of groups) {
    if (!("contents" in group) || !group.contents) continue;
    let blocks = group.contents.filter((b) => {
      if (!query) return true;
      const block = searchWorkspace!.newBlock(b.type);
      const label = block.toString();
      block.dispose();
      return `${label} ${b.type} ${group.name}`
        .replaceAll("_", " ")
        .toLowerCase()
        .includes(query.toLowerCase());
    });
    if (!query && name === "Events")
      blocks =
        group.name === "World"
          ? blocks.filter((b) => ["bark_forward", "bark_turn"].includes(b.type))
          : blocks.slice(0, group.name === "Events" ? 3 : 2);
    if (!blocks.length) continue;
    contents.push(
      {
        kind: "label",
        text: group.name === "Control" ? "Logic" : group.name,
        gap: 10,
      },
      ...blocks.map((block) => ({
        ...block,
        gap: 10,
        ...(["bark_forward", "bark_turn"].includes(block.type) ? { inputsInline: true } : {}),
      })),
    );
  }
  searchWorkspace?.dispose();
  if (!query && name === "Events") {
    const score = ws.getVariableMap().getVariable("score");
    if (score)
      contents.push(
        { kind: "label", text: "Variables", gap: 10 },
        {
          kind: "block",
          type: "variables_set",
          gap: 8,
          fields: { VAR: { id: score.getId() } },
          inputs: {
            VALUE: { shadow: { type: "math_number", fields: { NUM: 0 } } },
          },
        },
        {
          kind: "block",
          type: "math_change",
          gap: 8,
          fields: { VAR: { id: score.getId() } },
          inputs: {
            DELTA: { shadow: { type: "math_number", fields: { NUM: 1 } } },
          },
        },
      );
  }
  if (!contents.length)
    contents.push({ kind: "label", text: "No matching blocks" });
  ws.getFlyout()?.show(contents);
  for (const b of ws.getFlyout()?.getWorkspace().getAllBlocks(false) ?? []) {
    if (b.getParent() === null && b.width > 390) {
      b.setInputsInline(false);
      b.render();
    }
    b.setColour(
      b.type.startsWith("variables_") || b.type === "math_change"
        ? "#FF5148"
        : b.type.startsWith("controls")
          ? "#198AF2"
          : b.type.includes("start") ||
              b.type.includes("event") ||
              b.type.includes("touch")
            ? "#FFA500"
            : "#903AFF",
    );
  }
}
