import { createProject, defineEntity } from "@bark/engine";
import type { ProjectDocument } from "@bark/engine";
import type { GameDocument } from "../src/types";

export function sampleProject(): ProjectDocument {
  const project = createProject("Collect & create");
  project.settings.background = "#142A35";
  project.cameras = {
    ...project.cameras,
    active: "follow",
    targetId: "player",
    offset: { x: 0, y: 9, z: -12 },
  };
  project.input.spawn = ["KeyR"];
  project.entities = [
    defineEntity({
      id: "floor",
      name: "Meadow",
      visual: { kind: "box", size: { x: 24, y: 1, z: 24 }, color: "#467369" },
      transform: { position: { x: 0, y: -0.5, z: 3 } },
      collider: { size: { x: 24, y: 1, z: 24 } },
    }),
    defineEntity({
      id: "player",
      name: "Player",
      tags: ["player"],
      visual: { kind: "capsule", size: { x: 1, y: 2, z: 1 }, color: "#F8D17B" },
      transform: { position: { x: 0, y: 1.05, z: -3 } },
      collider: { shape: "capsule", size: { x: 1, y: 2, z: 1 } },
      body: { mass: 1, rotationLocked: true, friction: 0, restitution: 0 },
    }),
    ...[0, 1, 2].map((i) =>
      defineEntity({
        id: `gem${i + 1}`,
        name: `Gem ${i + 1}`,
        tags: ["collectible"],
        visual: { kind: "sphere", size: { x: 0.8, y: 0.8, z: 0.8 }, color: "#80E4C1" },
        transform: { position: { x: 0, y: 1, z: i * 2 } },
        collider: { shape: "sphere", trigger: true },
        body: { mode: "static" },
      }),
    ),
    defineEntity({
      id: "goal",
      name: "Finish",
      tags: ["goal"],
      visual: { kind: "box", size: { x: 4, y: 0.2, z: 2 }, color: "#DFA8FA" },
      transform: { position: { x: 0, y: 0.1, z: 7 } },
      collider: { size: { x: 4, y: 3, z: 2 }, trigger: true },
      body: { mode: "static" },
    }),
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
const b = (type: string, fields?: Record<string, unknown>, inputs?: Record<string, B>): B => ({
  type,
  ...(fields ? { fields } : {}),
  ...(inputs
    ? { inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { block: v }])) }
    : {}),
});
const n = (num: number) => b("math_number", { NUM: num });
const str = (text: string) => b("text", { TEXT: text });
const entity = () => b("bark_entity", { ENTITY: "player" });
const get = (id: string) => b("variables_get", { VAR: { id } });
const set = (id: string, val: B) => b("variables_set", { VAR: { id } }, { VALUE: val });
const chain = (...blocks: B[]) => {
  blocks.slice(0, -1).forEach((block, i) => {
    block.next = { block: blocks[i + 1] };
  });
  return blocks[0];
};
const iff = (condition: B, body: B, otherwise?: B) => ({
  ...b("controls_if", undefined, {
    IF0: condition,
    DO0: body,
    ...(otherwise ? { ELSE: otherwise } : {}),
  }),
  ...(otherwise ? { extraState: { hasElse: true } } : {}),
});
const compare = (a: B, c: B) => b("logic_compare", { OP: "EQ" }, { A: a, B: c });
const otherId = () => b("bark_entity_id", undefined, { ENTITY: b("bark_other") });

export function sampleWorkspace(): Record<string, unknown> {
  const roots: B[] = [
    b("bark_start", undefined, {
      DO: chain(
        set("score", n(0)),
        set("dx", n(0)),
        set("dz", n(0)),
        b("text_print", undefined, {
          TEXT: str("Collect the three gems. WASD to move, Space to jump, R to spawn."),
        }),
        b("bark_forever", undefined, {
          DO: b("bark_horizontal_velocity", undefined, {
            ENTITY: entity(),
            X: get("dx"),
            Z: get("dz"),
          }),
        }),
      ),
    }),
    ...(
      [
        ["forward", "dz", 5],
        ["backward", "dz", -5],
        ["left", "dx", -5],
        ["right", "dx", 5],
      ] as const
    ).map(([action, variable, speed]) =>
      b(
        "bark_input_event",
        { ACTION: action },
        {
          DO: iff(
            b("bark_event_state", { STATE: "held" }),
            set(variable, n(speed)),
            set(variable, n(0)),
          ),
        },
      ),
    ),
    b(
      "bark_input_event",
      { ACTION: "jump" },
      {
        DO: iff(
          b(
            "logic_operation",
            { OP: "AND" },
            {
              A: b("bark_event_state", { STATE: "pressed" }),
              B: b("bark_grounded", undefined, { ENTITY: entity() }),
            },
          ),
          b("bark_impulse", undefined, { ENTITY: entity(), X: n(0), Y: n(6), Z: n(0) }),
        ),
      },
    ),
    b(
      "bark_input_event",
      { ACTION: "spawn" },
      {
        DO: iff(
          b("bark_event_state", { STATE: "pressed" }),
          b("bark_spawn_do", { PREFAB: "crate" }, { X: n(3), Y: n(4), Z: n(0) }),
        ),
      },
    ),
    b(
      "bark_touch",
      { ENTITY: "player" },
      {
        DO: chain(
          iff(
            b(
              "logic_operation",
              { OP: "OR" },
              {
                A: compare(otherId(), str("gem1")),
                B: b(
                  "logic_operation",
                  { OP: "OR" },
                  { A: compare(otherId(), str("gem2")), B: compare(otherId(), str("gem3")) },
                ),
              },
            ),
            chain(
              b("bark_destroy", undefined, { ENTITY: b("bark_other") }),
              b("math_change", { VAR: { id: "score" } }, { DELTA: n(1) }),
              b("text_print", undefined, { TEXT: get("score") }),
            ),
          ),
          iff(
            compare(otherId(), str("goal")),
            b("text_print", undefined, { TEXT: str("Goal reached! Stop restores your world.") }),
          ),
        ),
      },
    ),
  ];
  roots.forEach((root, i) => {
    root.x = 30 + (i % 3) * 850;
    root.y = 30 + Math.floor(i / 3) * 650;
  });
  return {
    variables: ["score", "dx", "dz"].map((id) => ({ name: id, id })),
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

score = 0
dx = 0
dz = 0

@game.on_start
async def start():
    print("Collect the three gems. WASD to move, Space to jump, R to spawn.")
    player = game.entity("player")
    while True:
        await player.set_velocity(dx, None, dz)
        await game.next_frame()

@game.on_input("forward")
async def forward(state):
    global dz
    dz = 5 if state.held else 0

@game.on_input("backward")
async def backward(state):
    global dz
    dz = -5 if state.held else 0

@game.on_input("left")
async def left(state):
    global dx
    dx = -5 if state.held else 0

@game.on_input("right")
async def right(state):
    global dx
    dx = 5 if state.held else 0

@game.on_input("jump")
async def jump(state):
    player = game.entity("player")
    if state.pressed and await player.grounded():
        await player.apply_impulse(0, 6, 0)

@game.on_input("spawn")
async def spawn(state):
    if state.pressed:
        await game.spawn("crate", 3, 4, 0)

@game.on_touch("player")
async def collect(other_id):
    global score
    if other_id in ("gem1", "gem2", "gem3"):
        await game.entity(other_id).destroy()
        score += 1
        print(score)
    if other_id == "goal":
        print("Goal reached! Stop restores your world.")
`;
