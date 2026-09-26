import { createProject, defineEntity } from "@bark/engine";
import type { ProjectDocument } from "@bark/engine";
import type { GameDocument } from "../src/types";

export function sampleProject(): ProjectDocument {
  const project = createProject("Coin gate");
  project.settings.background = "#142A35";
  project.properties = { score: 0, seconds: 60, finished: false };
  project.cameras = {
    ...project.cameras,
    active: "follow",
    targetId: "player",
    offset: { x: 0, y: 9, z: -12 },
  };
  project.input.spawn = ["KeyR"];
  project.input.interact = ["KeyE"];
  project.entities = [
    defineEntity({
      id: "floor",
      name: "Meadow",
      visual: { kind: "box", size: { x: 24, y: 1, z: 28 }, color: "#467369" },
      transform: { position: { x: 0, y: -0.5, z: 3 } },
      collider: { size: { x: 24, y: 1, z: 28 } },
    }),
    defineEntity({
      id: "player",
      name: "Player",
      tags: ["player"],
      visual: { kind: "capsule", size: { x: 1, y: 2, z: 1 }, color: "#F8D17B" },
      transform: { position: { x: 0, y: 1.05, z: -3 } },
      collider: { shape: "capsule", size: { x: 1, y: 2, z: 1 } },
      body: { mass: 1, rotationLocked: true, friction: 0, restitution: 0 },
      character: { speed: 5, jumpSpeed: 6 },
      properties: { health: 100 },
    }),
    ...[0, 1, 2].map((i) =>
      defineEntity({
        id: `gem${i + 1}`,
        name: `Gem ${i + 1} (${i + 1} points)`,
        tags: ["collectible"],
        properties: { value: i + 1 },
        visual: {
          kind: "sphere",
          size: { x: 0.8, y: 0.8, z: 0.8 },
          color: ["#80E4C1", "#F8D17B", "#DFA8FA"][i],
        },
        transform: { position: { x: 0, y: 1, z: i * 2 } },
        collider: { shape: "sphere", trigger: true },
        body: { mode: "static" },
      }),
    ),
    defineEntity({
      id: "door",
      name: "Coin gate",
      properties: { cost: 6, locked: true },
      visual: { kind: "box", size: { x: 6, y: 3, z: 0.5 }, color: "#EAA36C" },
      transform: { position: { x: 0, y: 1.5, z: 7 } },
      collider: { size: { x: 6, y: 3, z: 0.5 } },
      body: { mode: "kinematic" },
      interaction: {
        enabled: true,
        prompt: "E · Open gate (6 points)",
        distance: 3,
      },
    }),
    ...[
      { id: "checkpoint", name: "Checkpoint", z: 5, color: "#80C7EE" },
      { id: "goal", name: "Finish", z: 10, color: "#DFA8FA" },
    ].map((e) =>
      defineEntity({
        id: e.id,
        name: e.name,
        tags: [e.id],
        visual: { kind: "box", size: { x: 4, y: 0.2, z: 1 }, color: e.color },
        transform: { position: { x: 0, y: 0.1, z: e.z } },
        collider: { size: { x: 4, y: 3, z: 1 }, trigger: true },
        body: { mode: "static" },
      }),
    ),
  ];
  project.prefabs = [
    {
      id: "crate",
      entities: [
        defineEntity({
          id: "crate-root",
          name: "Crate",
          visual: { kind: "box", size: { x: 1, y: 1, z: 1 }, color: "#F8A56A" },
          collider: {},
          body: { mass: 2 },
        }),
      ],
    },
  ];
  return project;
}

type B = {
  type: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block: B }>;
  next?: { block: B };
  extraState?: unknown;
  x?: number;
  y?: number;
};
const b = (
  type: string,
  fields?: Record<string, unknown>,
  inputs?: Record<string, B>,
): B => ({
  type,
  ...(fields ? { fields } : {}),
  ...(inputs
    ? {
        inputs: Object.fromEntries(
          Object.entries(inputs).map(([k, v]) => [k, { block: v }]),
        ),
      }
    : {}),
});
const n = (num: number) => b("math_number", { NUM: num });
const str = (text: string) => b("text", { TEXT: text });
const bool = (value: boolean) =>
  b("logic_boolean", { BOOL: value ? "TRUE" : "FALSE" });
const entity = (id = "player") => b("bark_entity", { ENTITY: id });
const get = (id: string) => b("variables_get", { VAR: { id } });
const set = (id: string, value: B) =>
  b("variables_set", { VAR: { id } }, { VALUE: value });
const chain = (...blocks: B[]) => {
  blocks.slice(0, -1).forEach((block, i) => {
    block.next = { block: blocks[i + 1] };
  });
  return blocks[0];
};
const iff = (condition: B, body: B, otherwise?: B): B => ({
  ...b("controls_if", undefined, {
    IF0: condition,
    DO0: body,
    ...(otherwise ? { ELSE: otherwise } : {}),
  }),
  ...(otherwise ? { extraState: { hasElse: true } } : {}),
});
const compare = (a: B, c: B, op = "EQ") =>
  b("logic_compare", { OP: op }, { A: a, B: c });
const and = (a: B, c: B) => b("logic_operation", { OP: "AND" }, { A: a, B: c });
const not = (a: B) => b("logic_negate", undefined, { BOOL: a });
const otherId = () =>
  b("bark_entity_id", undefined, { ENTITY: b("bark_other") });
const props = (id?: string) =>
  id
    ? b("bark_entity_properties", undefined, { ENTITY: entity(id) })
    : b("bark_world_properties");
const prop = (key: string, id?: string, fallback: B = n(0)) =>
  b("bark_property_get", undefined, {
    PROPERTIES: props(id),
    KEY: str(key),
    DEFAULT: fallback,
  });
const write = (key: string, value: B, id?: string) =>
  b("bark_property_set", undefined, {
    PROPERTIES: props(id),
    KEY: str(key),
    VALUE: value,
  });
const change = (key: string, value: B) =>
  b("bark_property_change", undefined, {
    PROPERTIES: props(),
    KEY: str(key),
    VALUE: value,
  });
const hud = (key: string, label: string) =>
  b("bark_hud", undefined, {
    KEY: str(key),
    LABEL: str(label),
    VALUE: prop(key),
  });
const notify = (text: string) =>
  b("bark_notify", undefined, { TEXT: str(text), SECONDS: n(3) });
const list = (...items: B[]): B => ({
  ...b(
    "lists_create_with",
    undefined,
    Object.fromEntries(items.map((x, i) => [`ADD${i}`, x])),
  ),
  extraState: { itemCount: items.length },
});
const input = (action: string) =>
  b("bark_input", { ACTION: action, STATE: "held" });
const difference = (a: string, c: string) =>
  b(
    "math_arithmetic",
    { OP: "MINUS" },
    {
      A: b("bark_convert", { TYPE: "number" }, { VALUE: input(a) }),
      B: b("bark_convert", { TYPE: "number" }, { VALUE: input(c) }),
    },
  );

export function sampleWorkspace(): Record<string, unknown> {
  const openCall: B = {
    ...b("procedures_callreturn", undefined, { ARG0: prop("cost", "door") }),
    extraState: { name: "try_open", params: ["cost"] },
  };
  const roots: B[] = [
    {
      ...b(
        "procedures_defreturn",
        { NAME: "try_open" },
        {
          STACK: iff(
            and(
              compare(prop("score"), get("cost"), "GTE"),
              prop("locked", "door", bool(true)),
            ),
            chain(
              write("locked", bool(false), "door"),
              b(
                "bark_glide",
                { EASING: "easeInOut" },
                {
                  ENTITY: entity("door"),
                  X: n(6),
                  Y: n(1.5),
                  Z: n(7),
                  SECONDS: n(1.5),
                },
              ),
              b("procedures_ifreturn", undefined, {
                CONDITION: bool(true),
                VALUE: bool(true),
              }),
            ),
          ),
          RETURN: bool(false),
        },
      ),
      extraState: { params: [{ name: "cost", id: "cost" }] },
    },
    b("bark_start", undefined, {
      DO: chain(
        set("collected", list()),
        hud("score", "Score"),
        hud("seconds", "Time"),
        b("text_print", undefined, {
          TEXT: str(
            "Collect the three gems. WASD to move, Space to jump, E to open the gate, R to spawn.",
          ),
        }),
        b(
          "bark_start_timer",
          { REPEAT: "true" },
          { NAME: str("countdown"), SECONDS: n(1) },
        ),
        b("bark_forever", undefined, {
          DO: chain(
            b("bark_walk", undefined, {
              ENTITY: entity(),
              X: difference("right", "left"),
              Z: difference("forward", "backward"),
            }),
            iff(
              compare(
                b(
                  "bark_axis",
                  { AXIS: "y" },
                  {
                    VECTOR: b("bark_position", undefined, { ENTITY: entity() }),
                  },
                ),
                n(-10),
                "LT",
              ),
              b("bark_respawn", undefined, { ENTITY: entity() }),
            ),
          ),
        }),
      ),
    }),
    ...["jump", "spawn", "interact"].map((action) =>
      b(
        "bark_input_event",
        { ACTION: action },
        {
          DO: iff(
            b("bark_event_state", { STATE: "pressed" }),
            action === "jump"
              ? b("bark_jump", undefined, { ENTITY: entity() })
              : action === "spawn"
                ? b(
                    "bark_spawn_do",
                    { PREFAB: "crate" },
                    { X: n(3), Y: n(4), Z: n(0) },
                  )
                : b("bark_try_interact", undefined, { ACTOR: str("player") }),
          ),
        },
      ),
    ),
    b(
      "bark_touch",
      { ENTITY: "player" },
      {
        DO: chain(
          iff(
            and(
              b("bark_contains", undefined, {
                LIST: list(str("gem1"), str("gem2"), str("gem3")),
                VALUE: otherId(),
              }),
              not(
                b("bark_contains", undefined, {
                  LIST: get("collected"),
                  VALUE: otherId(),
                }),
              ),
            ),
            chain(
              b("bark_list_append", undefined, {
                LIST: get("collected"),
                VALUE: otherId(),
              }),
              change(
                "score",
                b("bark_property_get", undefined, {
                  PROPERTIES: b("bark_entity_properties", undefined, {
                    ENTITY: b("bark_other"),
                  }),
                  KEY: str("value"),
                  DEFAULT: n(1),
                }),
              ),
              b("bark_destroy", undefined, { ENTITY: b("bark_other") }),
              hud("score", "Score"),
              b("text_print", undefined, { TEXT: prop("score") }),
            ),
          ),
          iff(
            compare(otherId(), str("checkpoint")),
            chain(
              b("bark_set_spawn", undefined, {
                ENTITY: entity(),
                X: n(0),
                Y: n(1.05),
                Z: n(5),
              }),
              notify("Checkpoint saved"),
            ),
          ),
          iff(
            and(
              compare(otherId(), str("goal")),
              and(
                not(prop("locked", "door", bool(true))),
                not(prop("finished", undefined, bool(false))),
              ),
            ),
            chain(
              write("finished", bool(true)),
              b("bark_cancel_timer", undefined, { NAME: str("countdown") }),
              b(
                "bark_spawn_do",
                { PREFAB: "crate" },
                { X: n(3), Y: n(4), Z: n(10) },
              ),
              notify("Goal reached! Stop restores your world."),
              b("text_print", undefined, {
                TEXT: str("Goal reached! Stop restores your world."),
              }),
            ),
          ),
        ),
      },
    ),
    b(
      "bark_interact",
      { ENTITY: "door" },
      {
        DO: iff(
          openCall,
          b("bark_broadcast", undefined, {
            NAME: str("door_opened"),
            VALUE: prop("score"),
          }),
          notify("Collect all gems first, or the gate is already open."),
        ),
      },
    ),
    b(
      "bark_message",
      { NAME: "door_opened" },
      {
        DO: chain(
          notify("Gate open! Follow the path to the goal."),
          b("text_print", undefined, { TEXT: b("bark_payload") }),
        ),
      },
    ),
    b(
      "bark_timer",
      { NAME: "countdown" },
      {
        DO: chain(
          change("seconds", n(-1)),
          hud("seconds", "Time"),
          iff(
            compare(prop("seconds"), n(0), "LTE"),
            chain(
              b("bark_cancel_timer", undefined, { NAME: str("countdown") }),
              notify("Time is up! Keep exploring, or Stop to reset."),
            ),
          ),
        ),
      },
    ),
    b(
      "bark_respawn_event",
      { ENTITY: "player" },
      { DO: notify("Back at your checkpoint") },
    ),
  ];
  roots.forEach((root, i) => {
    root.x = 30 + (i % 3) * 950;
    root.y = 30 + Math.floor(i / 3) * 1000;
  });
  return {
    variables: ["collected", "cost"].map((id) => ({ name: id, id })),
    blocks: { languageVersion: 0, blocks: roots },
  };
}
export function sampleDocument(): GameDocument<ProjectDocument> {
  return {
    version: 1,
    project: sampleProject(),
    script: { language: "blocks", workspace: sampleWorkspace() },
  };
}
export const samplePython = `from bark import game

collected = []

async def try_open(cost):
    door = game.entity("door")
    if await game.properties.get("score", 0) >= cost and await door.properties.get("locked", True):
        await door.properties.set("locked", False)
        await door.glide_to(6, 1.5, 7, 1.5, "easeInOut")
        return True
    return False

@game.on_start
async def start():
    print("Collect the three gems. WASD to move, Space to jump, E to open the gate, R to spawn.")
    await game.set_hud("score", "Score", await game.properties.get("score", 0))
    await game.set_hud("seconds", "Time", await game.properties.get("seconds", 60))
    await game.start_timer("countdown", 1, repeat=True)
    player = game.entity("player")
    while True:
        x = (await game.input("right")).held - (await game.input("left")).held
        z = (await game.input("forward")).held - (await game.input("backward")).held
        await player.walk(x, z)
        if (await player.position()).y < -10:
            await player.respawn()
        await game.next_frame()

@game.on_input("jump")
async def jump(state):
    if state.pressed:
        await game.entity("player").jump()

@game.on_input("spawn")
async def spawn(state):
    if state.pressed:
        await game.spawn("crate", 3, 4, 0)

@game.on_input("interact")
async def interact(state):
    if state.pressed:
        await game.interact("player")

@game.on_touch("player")
async def collect(other_id):
    if other_id in ("gem1", "gem2", "gem3") and other_id not in collected:
        collected.append(other_id)
        other = game.entity(other_id)
        await game.properties.change("score", await other.properties.get("value", 1))
        await other.destroy()
        score = await game.properties.get("score", 0)
        await game.set_hud("score", "Score", score)
        print(score)
    if other_id == "checkpoint":
        await game.entity("player").set_spawn(0, 1.05, 5)
        await game.notify("Checkpoint saved")
    if other_id == "goal" and not await game.entity("door").properties.get("locked", True) and not await game.properties.get("finished", False):
        await game.properties.set("finished", True)
        await game.cancel_timer("countdown")
        await game.spawn("crate", 3, 4, 10)
        await game.notify("Goal reached! Stop restores your world.")
        print("Goal reached! Stop restores your world.")

@game.on_interact("door")
async def open_gate(actor_id):
    if await try_open(await game.entity("door").properties.get("cost", 6)):
        await game.broadcast("door_opened", await game.properties.get("score", 0))
    else:
        await game.notify("Collect all gems first, or the gate is already open.")

@game.on_message("door_opened")
async def gate_opened(payload):
    await game.notify("Gate open! Follow the path to the goal.")
    print(payload)

@game.on_timer("countdown")
async def countdown():
    seconds = await game.properties.change("seconds", -1)
    await game.set_hud("seconds", "Time", seconds)
    if seconds <= 0:
        await game.cancel_timer("countdown")
        await game.notify("Time is up! Keep exploring, or Stop to reset.")

@game.on_respawn("player")
async def respawned():
    await game.notify("Back at your checkpoint")
`;
