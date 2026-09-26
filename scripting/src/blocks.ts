import * as Blockly from "blockly";
import "blockly/blocks";
import * as En from "blockly/msg/en";
import type { Compilation, ScriptCompiler, ScriptDocument } from "./types.js";

Blockly.setLocale(En as unknown as Record<string, string>);
export interface BlockChoices {
  entities: [string, string][];
  prefabs: [string, string][];
  actions: [string, string][];
}
let choices: BlockChoices = {
  entities: [["Player", "player"]],
  prefabs: [["Crate", "crate"]],
  actions: [["forward", "forward"]],
};
export function setBlockChoices(value: BlockChoices) {
  choices = value;
}
const dropdown = (kind: keyof BlockChoices) => ({
  type: "field_dropdown",
  name: kind === "actions" ? "ACTION" : kind === "prefabs" ? "PREFAB" : "ENTITY",
  options: () => (choices[kind].length ? choices[kind] : [["None available", ""]]),
});
const value = (name: string, check?: string | string[]) => ({
  type: "input_value",
  name,
  ...(check ? { check } : {}),
});
const statement = (name = "DO") => ({ type: "input_statement", name });
const select = (name: string, options: string[]) => ({
  type: "field_dropdown",
  name,
  options: options.map((v) => [v, v]),
});
const action = { previousStatement: null, nextStatement: null, colour: 170 };
Blockly.defineBlocksWithJsonArray([
  {
    type: "bark_start",
    message0: "when game starts %1 %2",
    args0: [{ type: "input_dummy" }, statement()],
    colour: 42,
  },
  {
    type: "bark_input_event",
    message0: "when input %1 changes %2 %3",
    args0: [dropdown("actions"), { type: "input_dummy" }, statement()],
    colour: 42,
  },
  {
    type: "bark_touch",
    message0: "when %1 touches something %2 %3",
    args0: [dropdown("entities"), { type: "input_dummy" }, statement()],
    colour: 42,
  },
  {
    type: "bark_interact",
    message0: "when %1 is interacted with %2 %3",
    args0: [dropdown("entities"), { type: "input_dummy" }, statement()],
    colour: 42,
  },
  {
    type: "bark_entity",
    message0: "entity %1",
    args0: [dropdown("entities")],
    output: "Entity",
    colour: 170,
  },
  { type: "bark_other", message0: "other entity from touch event", output: "Entity", colour: 42 },
  { type: "bark_actor", message0: "actor ID from interaction", output: "String", colour: 42 },
  {
    type: "bark_event_state",
    message0: "input event %1",
    args0: [select("STATE", ["held", "pressed", "released"])],
    output: "Boolean",
    colour: 42,
  },
  {
    type: "bark_entity_id",
    message0: "ID of %1",
    args0: [value("ENTITY", "Entity")],
    output: "String",
    colour: 170,
  },
  {
    type: "bark_move",
    message0: "move %1 x %2 y %3 z %4 in %5 space",
    args0: [
      value("ENTITY", "Entity"),
      value("X", "Number"),
      value("Y", "Number"),
      value("Z", "Number"),
      select("SPACE", ["world", "local"]),
    ],
    ...action,
  },
  {
    type: "bark_forward",
    message0: "move %1 forward %2",
    args0: [value("ENTITY", "Entity"), value("VALUE", "Number")],
    ...action,
  },
  {
    type: "bark_turn",
    message0: "turn %1 by %2 degrees",
    args0: [value("ENTITY", "Entity"), value("VALUE", "Number")],
    ...action,
  },
  {
    type: "bark_velocity",
    message0: "set velocity of %1 x %2 y %3 z %4",
    args0: [
      value("ENTITY", "Entity"),
      value("X", "Number"),
      value("Y", "Number"),
      value("Z", "Number"),
    ],
    ...action,
  },
  {
    type: "bark_horizontal_velocity",
    message0: "move %1 at x speed %2 z speed %3 (keep jump / fall)",
    args0: [value("ENTITY", "Entity"), value("X", "Number"), value("Z", "Number")],
    ...action,
  },
  {
    type: "bark_impulse",
    message0: "push %1 x %2 y %3 z %4",
    args0: [
      value("ENTITY", "Entity"),
      value("X", "Number"),
      value("Y", "Number"),
      value("Z", "Number"),
    ],
    ...action,
  },
  { type: "bark_destroy", message0: "destroy %1", args0: [value("ENTITY", "Entity")], ...action },
  {
    type: "bark_position",
    message0: "position of %1",
    args0: [value("ENTITY", "Entity")],
    output: "Vector",
    colour: 215,
  },
  {
    type: "bark_get_velocity",
    message0: "velocity of %1",
    args0: [value("ENTITY", "Entity")],
    output: "Vector",
    colour: 215,
  },
  {
    type: "bark_grounded",
    message0: "is %1 grounded",
    args0: [value("ENTITY", "Entity")],
    output: "Boolean",
    colour: 215,
  },
  {
    type: "bark_axis",
    message0: "%1 of vector %2",
    args0: [select("AXIS", ["x", "y", "z"]), value("VECTOR", "Vector")],
    output: "Number",
    colour: 215,
  },
  {
    type: "bark_input",
    message0: "input %1 is %2",
    args0: [dropdown("actions"), select("STATE", ["held", "pressed", "released"])],
    output: "Boolean",
    colour: 215,
  },
  {
    type: "bark_find",
    message0: "entities tagged %1",
    args0: [value("TAG", "String")],
    output: "Array",
    colour: 215,
  },
  {
    type: "bark_spawn",
    message0: "spawn %1 x %2 y %3 z %4",
    args0: [dropdown("prefabs"), value("X", "Number"), value("Y", "Number"), value("Z", "Number")],
    output: "Entity",
    colour: 170,
  },
  {
    type: "bark_spawn_do",
    message0: "spawn %1 x %2 y %3 z %4",
    args0: [dropdown("prefabs"), value("X", "Number"), value("Y", "Number"), value("Z", "Number")],
    ...action,
  },
  {
    type: "bark_wait",
    message0: "wait %1 seconds",
    args0: [value("SECONDS", "Number")],
    ...action,
    colour: 285,
  },
  { type: "bark_frame", message0: "wait for next frame", ...action, colour: 285 },
  {
    type: "bark_forever",
    message0: "forever %1 %2",
    args0: [{ type: "input_dummy" }, statement()],
    ...action,
    colour: 120,
  },
]);

const shadow = (num = 0) => ({ shadow: { type: "math_number", fields: { NUM: num } } });
const entity = () => ({ shadow: { type: "bark_entity" } });
const item = (type: string, inputs?: Record<string, unknown>) => ({
  kind: "block",
  type,
  ...(inputs ? { inputs } : {}),
});
const vectorInputs = { ENTITY: entity(), X: shadow(), Y: shadow(), Z: shadow() };
export const toolbox = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Events",
      colour: "42",
      contents: [
        "bark_start",
        "bark_input_event",
        "bark_touch",
        "bark_interact",
        "bark_other",
        "bark_actor",
        "bark_event_state",
      ].map((t) => item(t)),
    },
    {
      kind: "category",
      name: "World",
      colour: "170",
      contents: [
        item("bark_entity"),
        item("bark_move", vectorInputs),
        item("bark_forward", { ENTITY: entity(), VALUE: shadow(1) }),
        item("bark_turn", { ENTITY: entity(), VALUE: shadow(90) }),
        item("bark_horizontal_velocity", { ENTITY: entity(), X: shadow(), Z: shadow() }),
        item("bark_velocity", vectorInputs),
        item("bark_impulse", vectorInputs),
        item("bark_destroy", { ENTITY: entity() }),
        item("bark_spawn_do", { X: shadow(), Y: shadow(2), Z: shadow() }),
        item("bark_spawn", { X: shadow(), Y: shadow(2), Z: shadow() }),
      ],
    },
    {
      kind: "category",
      name: "Sensing",
      colour: "215",
      contents: ["bark_position", "bark_get_velocity", "bark_grounded", "bark_entity_id"]
        .map((t) => item(t, { ENTITY: entity() }))
        .concat([
          item("bark_axis"),
          item("bark_input"),
          item("bark_find", { TAG: { shadow: { type: "text", fields: { TEXT: "collectible" } } } }),
        ]),
    },
    {
      kind: "category",
      name: "Control",
      colour: "120",
      contents: [
        item("controls_if"),
        item("controls_repeat_ext", { TIMES: shadow(5) }),
        item("controls_whileUntil"),
        item("bark_forever"),
        item("controls_forEach"),
        item("bark_wait", { SECONDS: shadow(0.25) }),
        item("bark_frame"),
      ],
    },
    {
      kind: "category",
      name: "Logic & math",
      colour: "230",
      contents: [
        "logic_compare",
        "logic_operation",
        "logic_negate",
        "logic_boolean",
        "math_number",
        "math_arithmetic",
      ].map((t) => item(t)),
    },
    { kind: "category", name: "Variables", colour: "330", custom: "VARIABLE" },
    {
      kind: "category",
      name: "Text & output",
      colour: "160",
      contents: ["text", "text_print"].map((t) => item(t)),
    },
  ],
};

export function compileBlocks(script: ScriptDocument): Compilation {
  if (script.language !== "blocks") throw new Error("Expected blocks.");
  const workspace = new Blockly.Workspace();
  const result: Compilation = { python: "", sourceMap: {}, diagnostics: [] };
  try {
    Blockly.serialization.workspaces.load(script.workspace, workspace);
  } catch (error) {
    workspace.dispose();
    return { ...result, diagnostics: [{ message: `Cannot load blocks: ${String(error)}` }] };
  }
  const lines: string[] = [];
  const variables = workspace.getVariableMap().getAllVariables();
  const names = new Map(
    variables.map((v, index) => [
      v.getId(),
      `v_${v.getName().replace(/[^a-zA-Z0-9_]/g, "_") || "value"}_${index}`,
    ]),
  );
  let context = "",
    loop = 0;
  const emit = (line: string, depth = 0, block?: Blockly.Block) => {
    lines.push("    ".repeat(depth) + line);
    if (block) result.sourceMap[lines.length] = block.id;
  };
  const field = (b: Blockly.Block, name: string) => String(b.getFieldValue(name) ?? "");
  const variable = (b: Blockly.Block) => names.get(field(b, "VAR")) ?? "v_missing";
  const issue = (b: Blockly.Block, message: string) => {
    result.diagnostics.push({ blockId: b.id, message });
    return "None";
  };
  const input = (b: Blockly.Block, name: string): string => {
    const child = b.getInputTargetBlock(name);
    return child ? expr(child) : issue(b, `Fill the ${name.toLowerCase()} input.`);
  };
  const xyz = (b: Blockly.Block) => ["X", "Y", "Z"].map((n) => input(b, n)).join(", ");
  function expr(b: Blockly.Block): string {
    switch (b.type) {
      case "math_number": {
        const n = Number(field(b, "NUM"));
        return Number.isFinite(n) ? String(n) : issue(b, "Number must be finite.");
      }
      case "text":
        return JSON.stringify(field(b, "TEXT"));
      case "logic_boolean":
        return field(b, "BOOL") === "TRUE" ? "True" : "False";
      case "variables_get":
        return variable(b);
      case "math_arithmetic":
        return `(${input(b, "A")} ${{ ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/", POWER: "**" }[field(b, "OP") as "ADD"]} ${input(b, "B")})`;
      case "logic_compare":
        return `(${input(b, "A")} ${{ EQ: "==", NEQ: "!=", LT: "<", LTE: "<=", GT: ">", GTE: ">=" }[field(b, "OP") as "EQ"]} ${input(b, "B")})`;
      case "logic_operation":
        return `(${input(b, "A")} ${field(b, "OP") === "AND" ? "and" : "or"} ${input(b, "B")})`;
      case "logic_negate":
        return `(not ${input(b, "BOOL")})`;
      case "bark_entity":
        return `game.entity(${JSON.stringify(field(b, "ENTITY"))})`;
      case "bark_other":
        return context === "bark_touch"
          ? "game.entity(other_id)"
          : issue(b, "Other entity is only available inside a touch event.");
      case "bark_actor":
        return context === "bark_interact"
          ? "actor_id"
          : issue(b, "Actor ID is only available inside an interaction event.");
      case "bark_event_state":
        return context === "bark_input_event"
          ? `state.${field(b, "STATE")}`
          : issue(b, "Input state is only available inside an input event.");
      case "bark_entity_id":
        return `${input(b, "ENTITY")}.id`;
      case "bark_position":
        return `(await ${input(b, "ENTITY")}.position())`;
      case "bark_get_velocity":
        return `(await ${input(b, "ENTITY")}.velocity())`;
      case "bark_grounded":
        return `(await ${input(b, "ENTITY")}.grounded())`;
      case "bark_axis":
        return `${input(b, "VECTOR")}.${field(b, "AXIS")}`;
      case "bark_input":
        return `(await game.input(${JSON.stringify(field(b, "ACTION"))})).${field(b, "STATE")}`;
      case "bark_find":
        return `(await game.find(tag=${input(b, "TAG")}))`;
      case "bark_spawn":
        return `(await game.spawn(${JSON.stringify(field(b, "PREFAB"))}, ${xyz(b)}))`;
      default:
        return issue(b, `Unsupported expression block: ${b.type}`);
    }
  }
  function chain(first: Blockly.Block | null, depth: number) {
    if (!first) {
      emit("pass", depth);
      return;
    }
    const startLine = lines.length;
    for (let b: Blockly.Block | null = first; b; b = b.getNextBlock()) {
      if (!b.isEnabled()) continue;
      const out = (line: string) => emit(line, depth, b!);
      switch (b.type) {
        case "variables_set":
          out(`${variable(b)} = ${input(b, "VALUE")}`);
          break;
        case "math_change":
          out(`${variable(b)} += ${input(b, "DELTA")}`);
          break;
        case "text_print":
          out(`print(${input(b, "TEXT")})`);
          break;
        case "bark_move":
          out(
            `await ${input(b, "ENTITY")}.move(${xyz(b)}, space=${JSON.stringify(field(b, "SPACE"))})`,
          );
          break;
        case "bark_velocity":
        case "bark_impulse":
          out(
            `await ${input(b, "ENTITY")}.${b.type === "bark_velocity" ? "set_velocity" : "apply_impulse"}(${xyz(b)})`,
          );
          break;
        case "bark_horizontal_velocity":
          out(`await ${input(b, "ENTITY")}.set_velocity(${input(b, "X")}, None, ${input(b, "Z")})`);
          break;
        case "bark_forward":
        case "bark_turn":
          out(
            `await ${input(b, "ENTITY")}.${b.type === "bark_forward" ? "move_forward" : "turn"}(${input(b, "VALUE")})`,
          );
          break;
        case "bark_destroy":
          out(`await ${input(b, "ENTITY")}.destroy()`);
          break;
        case "bark_spawn_do":
          out(`await game.spawn(${JSON.stringify(field(b, "PREFAB"))}, ${xyz(b)})`);
          break;
        case "bark_wait":
          out(`await game.wait(${input(b, "SECONDS")})`);
          break;
        case "bark_frame":
          out("await game.next_frame()");
          break;
        case "controls_if":
          for (let i = 0; b.getInput(`IF${i}`); i++) {
            out(`${i ? "elif" : "if"} ${input(b, `IF${i}`)}:`);
            chain(b.getInputTargetBlock(`DO${i}`), depth + 1);
          }
          if (b.getInput("ELSE")) {
            out("else:");
            chain(b.getInputTargetBlock("ELSE"), depth + 1);
          }
          break;
        case "controls_repeat_ext":
        case "controls_whileUntil":
        case "bark_forever":
        case "controls_forEach": {
          if (b.type === "controls_repeat_ext")
            out(`for _repeat_${loop++} in range(max(0, int(${input(b, "TIMES")}))):`);
          else if (b.type === "controls_forEach") out(`for ${variable(b)} in ${input(b, "LIST")}:`);
          else
            out(
              `while ${b.type === "bark_forever" ? "True" : `${field(b, "MODE") === "UNTIL" ? "not " : ""}(${input(b, "BOOL")})`}:`,
            );
          emit("await game.next_frame()", depth + 1, b);
          chain(b.getInputTargetBlock("DO"), depth + 1);
          break;
        }
        default:
          issue(b, `Unsupported statement block: ${b.type}`);
      }
    }
    if (lines.length === startLine) emit("pass", depth, first);
  }
  try {
    emit("from bark import game");
    emit("");
    for (const name of names.values()) emit(`${name} = 0`);
    let handler = 0;
    for (const root of workspace.getTopBlocks(true)) {
      if (!root.isEnabled()) continue;
      context = root.type;
      let decorator: string,
        argument = "";
      switch (root.type) {
        case "bark_start":
          decorator = "game.on_start";
          break;
        case "bark_input_event":
          decorator = `game.on_input(${JSON.stringify(field(root, "ACTION"))})`;
          argument = "state";
          break;
        case "bark_touch":
          decorator = `game.on_touch(${JSON.stringify(field(root, "ENTITY"))})`;
          argument = "other_id";
          break;
        case "bark_interact":
          decorator = `game.on_interact(${JSON.stringify(field(root, "ENTITY"))})`;
          argument = "actor_id";
          break;
        default:
          issue(root, "Connect this block beneath an event.");
          continue;
      }
      emit("");
      emit(`@${decorator}`, 0, root);
      emit(`async def handler_${handler++}(${argument}):`, 0, root);
      if (names.size) emit(`global ${[...names.values()].join(", ")}`, 1, root);
      chain(root.getInputTargetBlock("DO"), 1);
    }
    if (!handler) result.diagnostics.push({ message: "Add at least one event block." });
    result.python = lines.join("\n") + "\n";
  } catch (error) {
    result.diagnostics.push({ message: String(error) });
  } finally {
    workspace.dispose();
  }
  return result;
}
export const blocksCompiler: ScriptCompiler = { language: "blocks", compile: compileBlocks };
