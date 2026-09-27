import * as Blockly from "blockly";
import "blockly/blocks";
import * as En from "blockly/msg/en";
// Hosts must inject editors with the instance that owns Bark's block definitions.
export { Blockly };
import type {
  Compilation,
  Diagnostic,
  ScriptCompiler,
  ScriptDocument,
} from "./types.js";
import {
  registerFeatureBlocks,
  featureCategories,
  featureExpression,
  featureStatement,
} from "./block-features.js";

Blockly.setLocale(En as unknown as Record<string, string>);
export interface BlockChoices {
  ownerId?: string | null;
  entities: [string, string][];
  prefabs: [string, string][];
  actions: [string, string][];
  properties?: Record<string, string[]>;
}
let choices: BlockChoices = {
  entities: [["Player", "player"]],
  prefabs: [["Crate", "crate"]],
  actions: [["forward", "forward"]],
};
export function setBlockChoices(value: BlockChoices) {
  choices = value;
}
export const SELF = "$this";
export const hasObjectContext = () => !!choices.ownerId;
const entityOptions = (): [string, string][] => [
  ...(choices.ownerId ? [["this object", SELF] as [string, string]] : []),
  ...(choices.entities.length ? choices.entities : [["None available", ""] as [string, string]]),
];
registerFeatureBlocks(entityOptions);
Blockly.Blocks.bark_property_key = {
  init(this: Blockly.Block) {
    this.appendDummyInput()
      .appendField("property key for")
      .appendField(
        new Blockly.FieldDropdown(() => [["World", ""], ...choices.entities]),
        "TARGET",
      )
      .appendField(new Blockly.FieldTextInput("score"), "KEY")
      .appendField(
        new Blockly.FieldDropdown(
          function (this: Blockly.FieldDropdown) {
            const target = this.getSourceBlock()?.getFieldValue("TARGET") ?? "";
            return [
              ["Suggestions…", ""],
              ...(choices.properties?.[target] ?? []).map(
                (key) => [key, key] as [string, string],
              ),
            ];
          },
          function (this: Blockly.FieldDropdown, key: string) {
            if (key) this.getSourceBlock()?.setFieldValue(key, "KEY");
            return "";
          },
        ),
        "SUGGEST",
      );
    this.setOutput(true, "String");
    this.setColour(190);
    this.setTooltip(
      "Choose a starting property or type a new key. Target only filters suggestions.",
    );
  },
};
/** Check saved IDs before Blockly can replace an unavailable dropdown value. */
export function validateBlockReferences(
  workspace: Record<string, unknown>,
  available: BlockChoices = choices,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const referenceFields: Record<
    string,
    ["entities" | "prefabs" | "actions", string]
  > = {
    bark_entity: ["entities", "ENTITY"],
    bark_touch: ["entities", "ENTITY"],
    bark_interact: ["entities", "ENTITY"],
    bark_touch_end: ["entities", "ENTITY"],
    bark_respawn_event: ["entities", "ENTITY"],
    bark_input: ["actions", "ACTION"],
    bark_input_event: ["actions", "ACTION"],
    bark_spawn: ["prefabs", "PREFAB"],
    bark_spawn_do: ["prefabs", "PREFAB"],
  };
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const block = value as {
      type?: string;
      id?: string;
      fields?: Record<string, unknown>;
      inputs?: Record<string, { block?: unknown; shadow?: unknown }>;
      next?: { block?: unknown; shadow?: unknown };
    };
    if (block.type === "bark_this" && !available.ownerId) diagnostics.push({ blockId: block.id, message: "This object is only available in object code." });
    const reference =
      block.type &&
      Object.hasOwn(referenceFields, block.type) &&
      referenceFields[block.type];
    if (reference) {
      const [kind, field] = reference,
        id = block.fields?.[field];
      if (
        id !== undefined &&
        !(kind === "entities" && id === SELF && available.ownerId) &&
        !available[kind].some(([, option]) => option === id)
      )
        diagnostics.push({
          blockId: block.id,
          message: `Unknown ${kind === "entities" ? "entity" : kind === "prefabs" ? "prefab" : "input action"} reference: ${String(id)}. Select an existing value.`,
        });
    }
    for (const input of Object.values(block.inputs ?? {})) {
      visit(input?.block);
      visit(input?.shadow);
    }
    visit(block.next?.block);
    visit(block.next?.shadow);
  };
  const roots = (workspace.blocks as { blocks?: unknown[] } | undefined)
    ?.blocks;
  if (Array.isArray(roots)) roots.forEach(visit);
  return diagnostics;
}
const dropdown = (kind: "entities" | "prefabs" | "actions") => ({
  type: "field_dropdown",
  name:
    kind === "actions" ? "ACTION" : kind === "prefabs" ? "PREFAB" : "ENTITY",
  options: () =>
    kind === "entities" ? entityOptions() : choices[kind].length ? choices[kind] : [["None available", ""]],
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
  { type: "bark_this", message0: "this object", output: "Entity", colour: 170 },
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
  {
    type: "bark_other",
    message0: "other entity from touch event",
    output: "Entity",
    colour: 42,
  },
  {
    type: "bark_actor",
    message0: "actor ID from interaction",
    output: "String",
    colour: 42,
  },
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
    args0: [
      value("ENTITY", "Entity"),
      value("X", "Number"),
      value("Z", "Number"),
    ],
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
  {
    type: "bark_destroy",
    message0: "destroy %1",
    args0: [value("ENTITY", "Entity")],
    ...action,
  },
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
    args0: [
      dropdown("actions"),
      select("STATE", ["held", "pressed", "released"]),
    ],
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
    args0: [
      dropdown("prefabs"),
      value("X", "Number"),
      value("Y", "Number"),
      value("Z", "Number"),
    ],
    output: "Entity",
    colour: 170,
  },
  {
    type: "bark_spawn_do",
    message0: "spawn %1 x %2 y %3 z %4",
    args0: [
      dropdown("prefabs"),
      value("X", "Number"),
      value("Y", "Number"),
      value("Z", "Number"),
    ],
    ...action,
  },
  {
    type: "bark_wait",
    message0: "wait %1 seconds",
    args0: [value("SECONDS", "Number")],
    ...action,
    colour: 285,
  },
  {
    type: "bark_frame",
    message0: "wait for next frame",
    ...action,
    colour: 285,
  },
  {
    type: "bark_forever",
    message0: "forever %1 %2",
    args0: [{ type: "input_dummy" }, statement()],
    ...action,
    colour: 120,
  },
]);

const shadow = (num = 0) => ({
  shadow: { type: "math_number", fields: { NUM: num } },
});
const entity = () => ({ shadow: { type: "bark_entity" } });
const item = (type: string, inputs?: Record<string, unknown>) => ({
  kind: "block",
  type,
  ...(inputs ? { inputs } : {}),
});
const vectorInputs = {
  ENTITY: entity(),
  X: shadow(),
  Y: shadow(),
  Z: shadow(),
};
export const toolbox = {
  kind: "categoryToolbox",
  contents: [
    ...featureCategories,
    { kind: "category", name: "My Blocks", colour: "290", custom: "PROCEDURE" },
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
        item("bark_this"),
        item("bark_entity"),
        item("bark_move", vectorInputs),
        item("bark_forward", { ENTITY: entity(), VALUE: shadow(1) }),
        item("bark_turn", { ENTITY: entity(), VALUE: shadow(90) }),
        item("bark_horizontal_velocity", {
          ENTITY: entity(),
          X: shadow(),
          Z: shadow(),
        }),
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
      contents: [
        "bark_position",
        "bark_get_velocity",
        "bark_grounded",
        "bark_entity_id",
      ]
        .map((t) => item(t, { ENTITY: entity() }))
        .concat([
          item("bark_axis"),
          item("bark_input"),
          item("bark_find", {
            TAG: { shadow: { type: "text", fields: { TEXT: "collectible" } } },
          }),
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

export function compileBlocks(
  script: ScriptDocument,
  available: BlockChoices = choices,
): Compilation {
  if (script.language !== "blocks") throw new Error("Expected blocks.");
  const diagnostics = validateBlockReferences(script.workspace, available);
  // Blockly repairs procedure callers while loading. Report broken saved signatures first.
  type Saved = {
    type?: string;
    id?: string;
    fields?: Record<string, unknown>;
    extraState?: { name?: string; params?: unknown[] };
    inputs?: Record<string, { block?: Saved; shadow?: Saved }>;
    next?: { block?: Saved };
  };
  const rootsValue = (
    script.workspace.blocks as { blocks?: Saved[] } | undefined
  )?.blocks;
  const savedRoots = Array.isArray(rootsValue) ? rootsValue : [];
  if (!savedRoots.length && !diagnostics.length) return { python: "", sourceMap: {}, diagnostics: [] };
  const signatures = new Map<string, number>();
  for (const root of savedRoots)
    if (root.type?.startsWith("procedures_def")) {
      const name = String(root.fields?.NAME ?? "");
      if (signatures.has(name))
        diagnostics.push({
          blockId: root.id,
          message: `Duplicate function name: ${name}`,
        });
      signatures.set(name, root.extraState?.params?.length ?? 0);
    }
  const validateCall = (block?: Saved) => {
    if (!block) return;
    if (block.type?.startsWith("procedures_call")) {
      const name = block.extraState?.name ?? String(block.fields?.NAME ?? "");
      if (!signatures.has(name))
        diagnostics.push({
          blockId: block.id,
          message: `Unknown function: ${name}. Add its definition.`,
        });
      else if ((block.extraState?.params?.length ?? 0) !== signatures.get(name))
        diagnostics.push({
          blockId: block.id,
          message: `Function ${name} requires ${signatures.get(name)} arguments. Recreate this call block.`,
        });
    }
    for (const input of Object.values(block.inputs ?? {})) {
      validateCall(input.block);
      validateCall(input.shadow);
    }
    validateCall(block.next?.block);
  };
  savedRoots.forEach(validateCall);
  if (diagnostics.length) return { python: "", sourceMap: {}, diagnostics };
  const previous = choices;
  choices = available;
  try {
    return compileWorkspace(script);
  } finally {
    choices = previous;
  }
}
function compileWorkspace(script: ScriptDocument): Compilation {
  if (script.language !== "blocks") throw new Error("Expected blocks.");
  const workspace = new Blockly.Workspace();
  const result: Compilation = { python: "", sourceMap: {}, diagnostics: [] };
  try {
    Blockly.serialization.workspaces.load(script.workspace, workspace);
  } catch (error) {
    workspace.dispose();
    return {
      ...result,
      diagnostics: [{ message: `Cannot load blocks: ${String(error)}` }],
    };
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
  let parameters = new Map<string, string>();
  const procedures = new Map<
    string,
    { name: string; args: string[]; returns: boolean; block: Blockly.Block }
  >();
  const emit = (line: string, depth = 0, block?: Blockly.Block) => {
    lines.push("    ".repeat(depth) + line);
    if (block) result.sourceMap[lines.length] = block.id;
  };
  const field = (b: Blockly.Block, name: string) =>
    String(b.getFieldValue(name) ?? "");
  const variable = (b: Blockly.Block) =>
    parameters.get(field(b, "VAR")) ??
    names.get(field(b, "VAR")) ??
    "v_missing";
  const issue = (b: Blockly.Block, message: string) => {
    result.diagnostics.push({ blockId: b.id, message });
    return "None";
  };
  const input = (b: Blockly.Block, name: string): string => {
    const child = b.getInputTargetBlock(name);
    return child
      ? expr(child)
      : issue(b, `Fill the ${name.toLowerCase()} input.`);
  };
  const xyz = (b: Blockly.Block) =>
    ["X", "Y", "Z"].map((n) => input(b, n)).join(", ");
  const featureContext = () => ({ input, field, issue, context });
  function call(b: Blockly.Block) {
    const state = b.saveExtraState?.() as
      { name?: string; params?: string[] } | undefined;
    const p = procedures.get(state?.name ?? field(b, "NAME"));
    if (!p)
      return issue(
        b,
        "This function does not exist. Add its definition or choose another function.",
      );
    const args = b.inputList.filter((i) => i.name.startsWith("ARG"));
    if (args.length !== p.args.length)
      return issue(b, `Function requires ${p.args.length} arguments.`);
    if (b.type === "procedures_callreturn" && !p.returns)
      return issue(b, "This function does not return a value.");
    return `(await ${p.name}(${args.map((i) => input(b, i.name)).join(", ")}))`;
  }
  function expr(b: Blockly.Block): string {
    const extension = featureExpression(b, featureContext());
    if (extension !== undefined) return extension;
    switch (b.type) {
      case "procedures_callreturn":
        return call(b);
      case "math_number": {
        const n = Number(field(b, "NUM"));
        return Number.isFinite(n)
          ? String(n)
          : issue(b, "Number must be finite.");
      }
      case "text":
        return JSON.stringify(field(b, "TEXT"));
      case "bark_property_key":
        return JSON.stringify(field(b, "KEY"));
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
      case "bark_this":
        return choices.ownerId ? "this" : issue(b, "This object is only available in object code.");
      case "bark_entity":
        return field(b, "ENTITY") === SELF ? "this" : `game.entity(${JSON.stringify(field(b, "ENTITY"))})`;
      case "bark_other":
        return ["bark_touch", "bark_touch_end"].includes(context)
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
      const out = (line: string) => {
        if (!line.startsWith("elif ") && line !== "else:")
          emit(`game._mark(${lines.length + 2})`, depth, b!);
        emit(line, depth, b!);
      };
      const extension = featureStatement(b, featureContext());
      if (extension !== undefined) {
        out(extension);
        continue;
      }
      switch (b.type) {
        case "procedures_callnoreturn":
          out(call(b));
          break;
        case "procedures_ifreturn":
          if (!context.startsWith("procedures_def")) {
            issue(b, "Return blocks belong inside a custom function.");
            break;
          }
          out(`if ${input(b, "CONDITION")}:`);
          emit(
            `return${b.getInput("VALUE") ? " " + input(b, "VALUE") : ""}`,
            depth + 1,
            b,
          );
          break;
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
          out(
            `await ${input(b, "ENTITY")}.set_velocity(${input(b, "X")}, None, ${input(b, "Z")})`,
          );
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
          out(
            `await game.spawn(${JSON.stringify(field(b, "PREFAB"))}, ${xyz(b)})`,
          );
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
            out(
              `for _repeat_${loop++} in range(max(0, int(${input(b, "TIMES")}))):`,
            );
          else if (b.type === "controls_forEach")
            out(`for ${variable(b)} in ${input(b, "LIST")}:`);
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
    emit("import random");
    emit("");
    for (const name of names.values()) emit(`${name} = 0`);
    for (const root of workspace.getTopBlocks(true)) {
      if (!root.isEnabled() || !root.type.startsWith("procedures_def"))
        continue;
      const def = (
        root as Blockly.Block & {
          getProcedureDef(): [string, string[], boolean];
        }
      ).getProcedureDef();
      if (procedures.has(def[0]))
        issue(root, `Duplicate function name: ${def[0]}`);
      else
        procedures.set(def[0], {
          name: `fn_${procedures.size}`,
          args: def[1],
          returns: def[2],
          block: root,
        });
    }
    for (const p of procedures.values()) {
      context = p.block.type;
      parameters = new Map();
      p.args.forEach((name, index) => {
        for (const variable of variables)
          if (variable.getName() === name)
            parameters.set(variable.getId(), `p_${index}`);
      });
      if (new Set(p.args).size !== p.args.length)
        issue(p.block, "Function parameters must have distinct names.");
      emit("");
      emit(
        `async def ${p.name}(${p.args.map((_, i) => `p_${i}`).join(", ")}):`,
        0,
        p.block,
      );
      const globals = [...names]
        .filter(([id]) => !parameters.has(id))
        .map(([, name]) => name);
      if (globals.length) emit(`global ${globals.join(", ")}`, 1, p.block);
      emit("await game._cooperate()", 1, p.block);
      chain(p.block.getInputTargetBlock("STACK"), 1);
      if (p.returns) emit(`return ${input(p.block, "RETURN")}`, 1, p.block);
    }
    parameters = new Map();
    let handler = 0;
    for (const root of workspace.getTopBlocks(true)) {
      if (!root.isEnabled()) continue;
      if (root.type.startsWith("procedures_def")) continue;
      context = root.type;
      let decorator: string,
        argument = "";
      switch (root.type) {
        case "bark_touch_end":
          decorator = `game.on_touch_end(${field(root, "ENTITY") === SELF ? "this.id" : JSON.stringify(field(root, "ENTITY"))})`;
          argument = "other_id";
          break;
        case "bark_respawn_event":
          decorator = `game.on_respawn(${field(root, "ENTITY") === SELF ? "this.id" : JSON.stringify(field(root, "ENTITY"))})`;
          break;
        case "bark_message":
          decorator = `game.on_message(${JSON.stringify(field(root, "NAME"))})`;
          argument = "payload";
          break;
        case "bark_timer":
          decorator = `game.on_timer(${JSON.stringify(field(root, "NAME"))})`;
          break;
        case "bark_start":
          decorator = "game.on_start";
          break;
        case "bark_input_event":
          decorator = `game.on_input(${JSON.stringify(field(root, "ACTION"))})`;
          argument = "state";
          break;
        case "bark_touch":
          decorator = `game.on_touch(${field(root, "ENTITY") === SELF ? "this.id" : JSON.stringify(field(root, "ENTITY"))})`;
          argument = "other_id";
          break;
        case "bark_interact":
          decorator = `game.on_interact(${field(root, "ENTITY") === SELF ? "this.id" : JSON.stringify(field(root, "ENTITY"))})`;
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
    if (!handler)
      result.diagnostics.push({ message: "Add at least one event block." });
    result.python = lines.join("\n") + "\n";
  } catch (error) {
    result.diagnostics.push({ message: String(error) });
  } finally {
    workspace.dispose();
  }
  return result;
}
export const blocksCompiler: ScriptCompiler = {
  language: "blocks",
  compile: compileBlocks,
};
