import { Blockly, compileBlocks, setBlockChoices, toolbox } from "../src/blocks";
import { sampleDocument } from "../playground/sample";
import { choicesFor } from "../src/game-file";

type Node = { type: string; id?: string; fields?: Record<string, unknown>; inputs?: Record<string, { block: Node }>; next?: { block: Node }; extraState?: unknown };
const n = (value = 1): Node => ({ type: "math_number", fields: { NUM: value } });
const text = (value: string): Node => ({ type: "text", fields: { TEXT: value } });
const entity = (id = "player"): Node => ({ type: "bark_entity", fields: { ENTITY: id } });
const node = (type: string, inputs: Record<string, Node> = {}, fields?: Record<string, unknown>): Node => ({ type, fields, inputs: Object.fromEntries(Object.entries(inputs).map(([key, block]) => [key, { block }])) });
const list = () => node("lists_create_with", { ADD0: n(), ADD1: n(2), ADD2: n(3) });
export const exposedTypes = [...new Set(toolbox.contents.flatMap((c) => "contents" in c ? c.contents!.map((b) => b.type) : [])),
  "variables_get", "variables_set", "math_change", "procedures_defnoreturn", "procedures_defreturn", "procedures_callnoreturn", "procedures_callreturn", "procedures_ifreturn"];

export function blockFixture(type: string, fieldOverride?: [string, string]) {
  const choices = { ...choicesFor(sampleDocument().project), ownerId: "player" };
  setBlockChoices(choices);
  const ws = new Blockly.Workspace();
  const block = ws.newBlock(type);
  const fields: Record<string, unknown> = {};
  for (const input of block.inputList) for (const field of input.fieldRow) if (field.name) fields[field.name] = field.getValue();
  if (fieldOverride) fields[fieldOverride[0]] = fieldOverride[1];
  if (block.getField("ENTITY")) fields.ENTITY = "player";
  if (block.getField("NAME")) fields.NAME = "audit";
  if (block.getField("VAR")) fields.VAR = { id: "audit-variable" };
  const inputs: Record<string, Node> = {};
  for (const input of block.inputList) {
    if (input.type !== Blockly.inputs.inputTypes.VALUE) continue;
    const name = input.name;
    const checks = input.connection?.getCheck() ?? [];
    let value: Node = n();
    if (name === "ENTITY") value = entity(["bark_glide", "bark_glide_result", "bark_rotate", "bark_rotate_result"].includes(type) ? "door" : "player");
    else if (name === "ACTOR" || name === "TARGET") value = text(name === "ACTOR" ? "player" : "door");
    else if (name === "PROPERTIES") value = node("bark_world_properties");
    else if (name === "KEY") value = text(`audit_${type}`);
    else if (["TEXT", "ID", "NAME", "LABEL", "TAG"].includes(name)) value = text(name === "ID" ? "player" : name === "NAME" ? "audit" : name === "TAG" ? "collectible" : "123");
    else if (name === "LIST" || (name === "VALUE" && type === "lists_length")) value = list();
    else if (name === "VECTOR") value = node("bark_position", { ENTITY: entity() });
    else if (name === "INDEX" || name === "START") value = n(0);
    else if (name === "SECONDS") value = n(0.05);
    else if (name === "VALUE" && type === "bark_result_status") value = node("bark_rotate_result", { ENTITY: entity("door"), VALUE: n(), SECONDS: n(0.05) });
    else if (name === "VALUE" && type === "text_length") value = text("abc");
    else if (checks.includes("Boolean") || ["BOOL", "CONDITION"].includes(name) || name.startsWith("IF")) value = node("logic_boolean", {}, { BOOL: "TRUE" });
    inputs[name] = value;
  }
  if (type === "bark_destroy") inputs.ENTITY = node("bark_spawn", { X: n(15), Y: n(2), Z: n(15) }, { PREFAB: "crate" });
  let target: Node = { type, id: `audit-${type}`, fields, inputs: Object.fromEntries(Object.entries(inputs).map(([key, block]) => [key, { block }])) };
  const marker = node("text_print", { TEXT: text(`PASS:${type}`) });
  const roots: Node[] = [];
  const eventFor: Record<string, string> = { bark_other: "bark_touch", bark_actor: "bark_interact", bark_event_state: "bark_input_event", bark_payload: "bark_message" };
  const isHat = !block.previousConnection && !block.outputConnection && !type.startsWith("procedures_");
  const isExpression = !!block.outputConnection;
  ws.dispose();
  if (type.startsWith("procedures_")) {
    const returns = type.includes("return") && type !== "procedures_defnoreturn" && type !== "procedures_callnoreturn";
    const definition = node(returns ? "procedures_defreturn" : "procedures_defnoreturn", returns ? { RETURN: n(7) } : {}, { NAME: "audit" });
    definition.extraState = { params: [] };
    if (type === "procedures_ifreturn") definition.inputs!.STACK = { block: target };
    roots.push(definition);
    const call: Node = { type: returns ? "procedures_callreturn" : "procedures_callnoreturn", extraState: { name: "audit", params: [] } };
    target = returns ? node("text_print", { TEXT: call }) : call;
    target.next = { block: marker };
    roots.push(node("bark_start", { DO: target }));
  } else if (isHat) {
    target.inputs!.DO = { block: marker };
    roots.push(target);
  } else {
    let body = isExpression ? node("text_print", { TEXT: target }) : target;
    body.next = { block: marker };
    if (type === "bark_forever") { target.inputs!.DO = { block: marker }; delete target.next; }
    if (type === "controls_whileUntil") {
      const get = node("variables_get", {}, { VAR: { id: "audit-variable" } });
      target.inputs!.BOOL = { block: node("logic_compare", { A: get, B: n(1) }, { OP: fields.MODE === "UNTIL" ? "GTE" : "LT" }) };
      target.inputs!.DO = { block: node("math_change", { DELTA: n(1) }, { VAR: { id: "audit-variable" } }) };
    }
    if (type === "bark_property_change") {
      const setup = node("bark_property_set", { PROPERTIES: node("bark_world_properties"), KEY: text(`audit_${type}`), VALUE: n(0) });
      setup.next = { block: body }; body = setup;
    }
    const eventType = eventFor[type] ?? "bark_start";
    roots.push(node(eventType, { DO: body }, eventType === "bark_touch" || eventType === "bark_interact" ? { ENTITY: "player" } : eventType === "bark_input_event" ? { ACTION: "forward" } : eventType === "bark_message" ? { NAME: "audit" } : undefined));
  }
  const workspace = { variables: [{ name: "audit", id: "audit-variable" }], blocks: { languageVersion: 0, blocks: roots } };
  return { workspace, compilation: compileBlocks({ language: "blocks", workspace }, choices) };
}

export function dropdownModes(type: string): [string, string][] {
  const ws = new Blockly.Workspace();
  try {
    const block = ws.newBlock(type);
    return block.inputList.flatMap((input) => input.fieldRow.flatMap((field) => field instanceof Blockly.FieldDropdown && !["ENTITY", "ACTION", "PREFAB", "VAR", "TARGET", "SUGGEST"].includes(field.name ?? "")
      ? field.getOptions(false).map((option): [string, string] => [field.name!, option[1]]) : []));
  } finally { ws.dispose(); }
}
