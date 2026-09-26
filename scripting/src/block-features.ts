import * as Blockly from "blockly";

const v = (name: string) => ({ type: "input_value", name });
const text = (name: string, value = "event") => ({
  type: "field_input",
  name,
  text: value,
});
const menu = (name: string, values: string[]) => ({
  type: "field_dropdown",
  name,
  options: values.map((x) => [x, x]),
});
const definitions: object[] = [];
const add = (
  type: string,
  message0: string,
  args0: object[],
  output?: string | null,
) =>
  definitions.push({
    type,
    message0,
    args0,
    colour: 190,
    ...(output !== undefined
      ? { output }
      : { previousStatement: null, nextStatement: null }),
  });
const hat = (type: string, message: string, field: object) =>
  definitions.push({
    type,
    message0: message + " %2 %3",
    args0: [
      field,
      { type: "input_dummy" },
      { type: "input_statement", name: "DO" },
    ],
    colour: 42,
  });
export function registerFeatureBlocks(entities: () => string[][]) {
  const entity = () => ({
    type: "field_dropdown",
    name: "ENTITY",
    options: entities,
  });
  hat("bark_touch_end", "when %1 stops touching", entity());
  hat("bark_respawn_event", "when %1 respawns", entity());
  hat("bark_message", "when message %1 arrives", text("NAME"));
  hat("bark_timer", "when timer %1 fires", text("NAME", "countdown"));
  add("bark_payload", "message payload", [], null);
  add("bark_walk", "walk %1 direction x %2 z %3", [
    v("ENTITY"),
    v("X"),
    v("Z"),
  ]);
  for (const op of ["jump", "respawn"])
    add(`bark_${op}`, `${op} %1`, [v("ENTITY")]);
  add("bark_jump_result", "jump %1 accepted", [v("ENTITY")], "Boolean");
  for (const op of ["teleport", "set_spawn"])
    add(`bark_${op}`, `${op.replaceAll("_", " ")} %1 x %2 y %3 z %4`, [
      v("ENTITY"),
      v("X"),
      v("Y"),
      v("Z"),
    ]);
  const easing = () =>
    menu("EASING", ["linear", "easeIn", "easeOut", "easeInOut"]);
  add("bark_glide", "glide %1 to x %2 y %3 z %4 in %5 seconds %6", [
    v("ENTITY"),
    v("X"),
    v("Y"),
    v("Z"),
    v("SECONDS"),
    easing(),
  ]);
  add("bark_rotate", "rotate %1 to Y %2 degrees in %3 seconds %4", [
    v("ENTITY"),
    v("VALUE"),
    v("SECONDS"),
    easing(),
  ]);
  add(
    "bark_glide_result",
    "glide %1 to x %2 y %3 z %4 in %5 seconds %6 result",
    [v("ENTITY"), v("X"), v("Y"), v("Z"), v("SECONDS"), easing()],
    null,
  );
  add(
    "bark_rotate_result",
    "rotate %1 to Y %2 degrees in %3 seconds %4 result",
    [v("ENTITY"), v("VALUE"), v("SECONDS"), easing()],
    null,
  );
  add(
    "bark_result_status",
    "status of action result %1",
    [v("VALUE")],
    "String",
  );
  add(
    "bark_target",
    "interaction target of actor ID %1",
    [v("ACTOR")],
    "Entity",
  );
  add("bark_try_interact", "interact as actor ID %1", [v("ACTOR")]);
  add(
    "bark_interact_result",
    "interact as actor ID %1 with target ID %2 accepted",
    [v("ACTOR"), v("TARGET")],
    "Boolean",
  );
  add("bark_entity_from_id", "entity with ID %1", [v("ID")], "Entity");
  add("bark_world_properties", "world properties", [], "Properties");
  add(
    "bark_entity_properties",
    "properties of %1",
    [v("ENTITY")],
    "Properties",
  );
  for (const op of ["get", "has", "remove"])
    add(
      `bark_property_${op}`,
      `${op} property %1 key %2${op === "get" ? " default %3" : ""}`,
      [v("PROPERTIES"), v("KEY"), ...(op === "get" ? [v("DEFAULT")] : [])],
      op === "has" || op === "remove" ? "Boolean" : null,
    );
  add("bark_property_list", "all properties of %1", [v("PROPERTIES")], null);
  for (const op of ["set", "change"])
    add(`bark_property_${op}`, `${op} property %1 key %2 value %3`, [
      v("PROPERTIES"),
      v("KEY"),
      v("VALUE"),
    ]);
  add("bark_property_remove_do", "remove property %1 key %2", [
    v("PROPERTIES"),
    v("KEY"),
  ]);
  add("bark_hud", "HUD key %1 label %2 value %3", [
    v("KEY"),
    v("LABEL"),
    v("VALUE"),
  ]);
  add("bark_remove_hud", "remove HUD %1", [v("KEY")]);
  add("bark_notify", "notify %1 for %2 seconds", [v("TEXT"), v("SECONDS")]);
  add("bark_broadcast", "broadcast %1 payload %2", [v("NAME"), v("VALUE")]);
  add("bark_start_timer", "start timer %1 every %2 seconds repeat %3", [
    v("NAME"),
    v("SECONDS"),
    menu("REPEAT", ["false", "true"]),
  ]);
  add("bark_cancel_timer", "cancel timer %1", [v("NAME")]);
  add(
    "bark_list_get",
    "list %1 at index %2 (first = 0)",
    [v("LIST"), v("INDEX")],
    null,
  );
  add("bark_list_set", "set list %1 at index %2 (first = 0) to %3", [
    v("LIST"),
    v("INDEX"),
    v("VALUE"),
  ]);
  add("bark_list_append", "append %2 to list %1", [v("LIST"), v("VALUE")]);
  add("bark_list_remove", "remove from list %1 at index %2 (first = 0)", [
    v("LIST"),
    v("INDEX"),
  ]);
  add("bark_contains", "%1 contains %2", [v("LIST"), v("VALUE")], "Boolean");
  add(
    "bark_slice",
    "text %1 from index %2 inclusive to %3 exclusive (first = 0)",
    [v("TEXT"), v("START"), v("END")],
    "String",
  );
  add(
    "bark_convert",
    "convert %1 to %2",
    [v("VALUE"), menu("TYPE", ["text", "number"])],
    null,
  );
  Blockly.defineBlocksWithJsonArray(definitions);
}

type Context = {
  input(b: Blockly.Block, name: string): string;
  field(b: Blockly.Block, name: string): string;
  issue(b: Blockly.Block, message: string): string;
  context: string;
};
export function featureExpression(
  b: Blockly.Block,
  c: Context,
): string | undefined {
  const i = (name: string) => c.input(b, name),
    f = (name: string) => c.field(b, name);
  switch (b.type) {
    case "bark_payload":
      return c.context === "bark_message"
        ? "payload"
        : c.issue(b, "Payload is only available inside a message handler.");
    case "bark_entity_from_id":
      return `game.entity(${i("ID")})`;
    case "bark_world_properties":
      return "game.properties";
    case "bark_entity_properties":
      return `${i("ENTITY")}.properties`;
    case "bark_property_get":
      return `(await ${i("PROPERTIES")}.get(${i("KEY")}, ${i("DEFAULT")}))`;
    case "bark_property_has":
    case "bark_property_remove":
      return `(await ${i("PROPERTIES")}.${b.type.slice(14)}(${i("KEY")}))`;
    case "bark_property_list":
      return `(await ${i("PROPERTIES")}.list())`;
    case "bark_target":
      return `(await game.target(${i("ACTOR")}))`;
    case "bark_interact_result":
      return `(await game.interact(${i("ACTOR")}, ${i("TARGET")}))`;
    case "bark_jump_result":
      return `(await ${i("ENTITY")}.jump())`;
    case "bark_glide_result":
      return `(await ${i("ENTITY")}.glide_to(${i("X")}, ${i("Y")}, ${i("Z")}, ${i("SECONDS")}, ${JSON.stringify(f("EASING"))}))`;
    case "bark_rotate_result":
      return `(await ${i("ENTITY")}.rotate_to(${i("VALUE")}, ${i("SECONDS")}, ${JSON.stringify(f("EASING"))}))`;
    case "bark_result_status":
      return `${i("VALUE")}["status"]`;
    case "lists_create_with":
      return `[${b.inputList
        .filter((x) => x.name.startsWith("ADD"))
        .map((x) => i(x.name))
        .join(", ")}]`;
    case "lists_length":
      return `len(${i("VALUE")})`;
    case "bark_list_get":
      return `${i("LIST")}[int(${i("INDEX")})]`;
    case "bark_contains":
      return `(${i("VALUE")} in ${i("LIST")})`;
    case "text_join":
      return `(${
        b.inputList
          .filter((x) => x.name.startsWith("ADD"))
          .map((x) => `str(${i(x.name)})`)
          .join(" + ") || '""'
      })`;
    case "text_length":
      return `len(${i("VALUE")})`;
    case "bark_slice":
      return `${i("TEXT")}[int(${i("START")}):int(${i("END")})]`;
    case "bark_convert":
      return `${f("TYPE") === "text" ? "str" : "float"}(${i("VALUE")})`;
    case "math_random_int":
      return `random.randint(int(${i("FROM")}), int(${i("TO")}))`;
    case "math_random_float":
      return "random.random()";
    case "logic_null":
      return "None";
  }
}
export function featureStatement(
  b: Blockly.Block,
  c: Context,
): string | undefined {
  const i = (name: string) => c.input(b, name),
    f = (name: string) => c.field(b, name);
  switch (b.type) {
    case "bark_walk":
      return `await ${i("ENTITY")}.walk(${i("X")}, ${i("Z")})`;
    case "bark_jump":
    case "bark_respawn":
      return `await ${i("ENTITY")}.${b.type.slice(5)}()`;
    case "bark_teleport":
    case "bark_set_spawn":
      return `await ${i("ENTITY")}.${b.type.slice(5)}(${i("X")}, ${i("Y")}, ${i("Z")})`;
    case "bark_glide":
      return `await ${i("ENTITY")}.glide_to(${i("X")}, ${i("Y")}, ${i("Z")}, ${i("SECONDS")}, ${JSON.stringify(f("EASING"))})`;
    case "bark_rotate":
      return `await ${i("ENTITY")}.rotate_to(${i("VALUE")}, ${i("SECONDS")}, ${JSON.stringify(f("EASING"))})`;
    case "bark_try_interact":
      return `await game.interact(${i("ACTOR")})`;
    case "bark_property_set":
    case "bark_property_change":
      return `await ${i("PROPERTIES")}.${b.type.slice(14)}(${i("KEY")}, ${i("VALUE")})`;
    case "bark_property_remove_do":
      return `await ${i("PROPERTIES")}.remove(${i("KEY")})`;
    case "bark_hud":
      return `await game.set_hud(${i("KEY")}, ${i("LABEL")}, ${i("VALUE")})`;
    case "bark_remove_hud":
      return `await game.remove_hud(${i("KEY")})`;
    case "bark_notify":
      return `await game.notify(${i("TEXT")}, ${i("SECONDS")})`;
    case "bark_broadcast":
      return `await game.broadcast(${i("NAME")}, ${i("VALUE")})`;
    case "bark_start_timer":
      return `await game.start_timer(${i("NAME")}, ${i("SECONDS")}, repeat=${f("REPEAT") === "true" ? "True" : "False"})`;
    case "bark_cancel_timer":
      return `await game.cancel_timer(${i("NAME")})`;
    case "bark_list_set":
      return `${i("LIST")}[int(${i("INDEX")})] = ${i("VALUE")}`;
    case "bark_list_append":
      return `${i("LIST")}.append(${i("VALUE")})`;
    case "bark_list_remove":
      return `${i("LIST")}.pop(int(${i("INDEX")}))`;
  }
}
export const featureCategories = [
  {
    name: "Characters & motion",
    types: [
      "bark_walk",
      "bark_jump",
      "bark_jump_result",
      "bark_teleport",
      "bark_set_spawn",
      "bark_respawn",
      "bark_glide",
      "bark_rotate",
      "bark_glide_result",
      "bark_rotate_result",
      "bark_result_status",
      "bark_target",
      "bark_try_interact",
      "bark_interact_result",
      "bark_entity_from_id",
    ],
  },
  {
    name: "Properties & HUD",
    types: [
      "bark_world_properties",
      "bark_entity_properties",
      "bark_property_key",
      "bark_property_get",
      "bark_property_has",
      "bark_property_set",
      "bark_property_change",
      "bark_property_remove_do",
      "bark_property_remove",
      "bark_property_list",
      "bark_hud",
      "bark_remove_hud",
      "bark_notify",
    ],
  },
  {
    name: "Messages & timers",
    types: [
      "bark_message",
      "bark_payload",
      "bark_broadcast",
      "bark_timer",
      "bark_start_timer",
      "bark_cancel_timer",
      "bark_touch_end",
      "bark_respawn_event",
    ],
  },
  {
    name: "Lists & text",
    types: [
      "lists_create_with",
      "lists_length",
      "bark_list_get",
      "bark_list_set",
      "bark_list_append",
      "bark_list_remove",
      "bark_contains",
      "text_join",
      "text_length",
      "bark_slice",
      "bark_convert",
      "math_random_int",
      "math_random_float",
      "logic_null",
    ],
  },
].map(({ name, types }) => ({
  kind: "category",
  name,
  colour: "190",
  contents: types.map((type) => ({ kind: "block", type })),
}));
