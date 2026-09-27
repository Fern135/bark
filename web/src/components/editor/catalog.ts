import { createProject, defineEntity } from "@bark/engine";
import type {
  EntityDefinition,
  ProjectDocument,
  Vec3,
  PrimitiveShape,
} from "@bark/engine";
import type { GameDocument } from "@bark/scripting";
import models from "../../../public/models/starter/manifest.json";
import toys from "../../../public/models/toys/manifest.json";
import byte from "../../../public/models/byte/manifest.json";
export type Category = "Character" | "Tool" | "Object" | "Item";
export const categories: Category[] = ["Character", "Tool", "Object", "Item"];
export interface CatalogItem {
  id: string;
  name: string;
  category: Category;
  color: string;
  shape: PrimitiveShape;
  size: Vec3;
  model?: string;
}
const entries: [keyof typeof models, string, Category][] = [
  ["player", "Byte", "Character"],
  ["tree", "Oak tree", "Object"],
  ["rock", "Pebble", "Object"],
  ["crate", "Wooden crate", "Object"],
  ["gem", "Crystal", "Item"],
  ["flag", "Trail flag", "Tool"],
  ["platform", "Stepping stone", "Object"],
  ["flower", "Wildflower", "Object"],
  ["bridge", "Wooden bridge", "Object"],
  ["bush", "Leafy bush", "Object"],
  ["fence", "Garden fence", "Object"],
  ["mushroom", "Mushrooms", "Object"],
  ["pine", "Pine tree", "Object"],
  ["tent", "Camping tent", "Object"],
  ["sign", "Trail sign", "Tool"],
  ["robot", "Little adventurer", "Character"],
];
export const catalog: CatalogItem[] = entries.map(([id, name, category]) => ({
  id,
  name,
  category,
  color: "#8BCBB3",
  shape: category === "Character" ? "capsule" : "box",
  size: id === "player" ? byte.size : id in toys ? toys[id as keyof typeof toys].size : models[id].size,
  model: id === "player" ? "/models/byte/player.glb" : `/models/${id in toys ? "toys" : "starter"}/${id}.glb`,
}));
catalog.splice(4, 0, {
  id: "ball",
  name: "Bouncy ball",
  category: "Item",
  color: "#E58CBA",
  shape: "sphere",
  size: { x: 1, y: 1, z: 1 },
});
export function catalogAssets() {
  return catalog
    .filter((i) => i.model)
    .map((i) => ({
      id: `starter-${i.id}`,
      type: "model" as const,
      url: i.model!,
    }));
}
export function makeObject(
  item: CatalogItem,
  id = crypto.randomUUID(),
  position?: Vec3,
): EntityDefinition[] {
  const character = item.category === "Character";
  return [
    defineEntity({
      id,
      name: item.name,
      tags: [`starter:${item.id}`, `category:${item.category}`],
      transform: {
        position: position ?? { x: 0, y: item.size.y / 2 + 0.02, z: 0 },
      },
      visual: item.model
        ? { kind: "model", assetId: `starter-${item.id}` }
        : { kind: item.shape, size: { ...item.size }, color: item.color },
      collider: {
        shape: character ? "capsule" : item.shape,
        size: character ? { x: 1, y: 2, z: 1 } : { ...item.size },
      },
      body: {
        mode: character || item.id === "ball" ? "dynamic" : "static",
        rotationLocked: character,
        restitution: item.id === "ball" ? 0.85 : 0.1,
      },
      character: character ? { speed: 5, jumpSpeed: 6 } : null,
    }),
  ];
}
export function starterGame(): GameDocument<ProjectDocument> {
  const project = createProject("My first world");
  project.assets = catalogAssets();
  project.settings = {
    ...project.settings,
    background: "#DCF2FB",
    ambientIntensity: 0.65,
    sunIntensity: 0.7,
    shadows: true,
  };
  project.cameras.target = { x: 0, y: 1, z: 0 };
  const object = (key: string, id: string, x: number, z: number, scale = 1) => {
    const item = catalog.find((i) => i.id === key)!;
    const e = makeObject(item, id, {
      x,
      y: (item.size.y * scale) / 2 + 0.03,
      z,
    })[0];
    const names: Record<string, string> = {
      player: "Byte",
      tree: "Tree",
      rock: "Rock",
      ball: "Ball",
      flag: "Flag",
      flower: "Flower",
      bridge: "Bridge",
      bush: "Bush",
      fence: "Fence",
      gem: "Gem",
      crate: "Crate",
      mushroom: "Mushrooms",
      pine: "Pine",
      tent: "Tent",
    };
    e.name = names[key] ?? item.name;
    e.transform.scale = { x: scale, y: scale, z: scale };
    return e;
  };
  project.entities = [
    defineEntity({
      id: "ground",
      name: "Meadow",
      tags: ["ground"],
      transform: { position: { x: 0, y: -0.5, z: 0 } },
      visual: { kind: "box", size: { x: 18, y: 1, z: 16 }, color: "#78AD64" },
      collider: { size: { x: 18, y: 1, z: 16 } },
      body: { mode: "static" },
    }),
    object("player", "player", 0, -1),
    object("rock", "pebble", -3, -2),
    object("crate", "crate", 4, 0),
    object("tree", "tree-left", -5, 2),
    object("gem", "crystal", -1, -4),
    object("flag", "flag", 1, 4),
    object("ball", "ball", 2, -1),
    object("flower", "flower", -2, 1),
    object("bridge", "bridge", -4, -5, 1.7),
    object("bush", "bush", 4, -4),
    object("fence", "fence", 6, 0),
    object("tree", "tree-right", 5, 3, 1.2),
    object("mushroom", "mushrooms", -6, 4),
    object("pine", "pine", -1, 5),
    object("tent", "tent", 4, 5),
  ];
  // Landscape details stay together under Meadow in the scene browser.
  const decor = (
    id: string,
    position: Vec3,
    size: Vec3,
    color: string,
    kind: PrimitiveShape = "box",
  ) =>
    defineEntity({
      id,
      name: id,
      parentId: "ground",
      transform: { position },
      visual: { kind, size, color },
    });
  project.entities.push(
    decor(
      "island-earth",
      { x: 0, y: -0.55, z: 0 },
      { x: 18.4, y: 1.4, z: 16.4 },
      "#BBA984",
    ),
    decor(
      "river",
      { x: -4, y: 0.515, z: 0 },
      { x: 2.2, y: 0.025, z: 16 },
      "#74C9DB",
    ),
  );
  for (let i = 0; i < 9; i++)
    project.entities.push(
      decor(
        `path-${i}`,
        { x: 0.7 * Math.sin(i * 0.65), y: 0.52, z: i * 1.55 - 6 },
        { x: 2.3, y: 0.04, z: 1.7 },
        "#DACA9F",
        "sphere",
      ),
    );
  for (let i = 0; i < 16; i++) {
    const e = object(
      i % 3 === 0 ? "flower" : "bush",
      `meadow-detail-${i}`,
      (i % 2 ? 1 : -1) * (5.6 + (i % 3) * 0.8),
      -6 + Math.floor(i / 2) * 1.7,
      i % 3 === 0 ? 0.65 : 0.45,
    );
    e.parentId = "ground";
    e.transform.position.y += 0.5;
    e.collider = null;
    e.body = null;
    project.entities.push(e);
  }
  return {
    version: 1,
    project,
    script: {
      language: "blocks",
      workspace: {
        variables: [{ name: "score", id: "score" }],
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "bark_start",
              x: 110,
              y: 92,
              inputs: {
                DO: {
                  block: {
                    type: "text_print",
                    inputs: {
                      TEXT: {
                        block: {
                          type: "text",
                          fields: {
                            TEXT: "Hello, world!",
                          },
                        },
                      },
                    },
                    next: {
                      block: {
                        type: "bark_forever",
                        collapsed: true,
                        inputs: {
                          DO: {
                            block: {
                              type: "bark_walk",
                              inputs: {
                                ENTITY: {
                                  block: {
                                    type: "bark_entity",
                                    fields: { ENTITY: "player" },
                                  },
                                },
                                X: inputDifference("right", "left"),
                                Z: inputDifference("forward", "backward"),
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            {
              type: "bark_input_event",
              fields: { ACTION: "jump" },
              x: 110,
              y: 325,
              inputs: {
                DO: {
                  block: {
                    type: "controls_if",
                    inputs: {
                      IF0: {
                        block: {
                          type: "bark_event_state",
                          fields: { STATE: "pressed" },
                        },
                      },
                      DO0: {
                        block: {
                          type: "bark_jump",
                          inputs: {
                            ENTITY: {
                              block: {
                                type: "bark_entity",
                                fields: { ENTITY: "player" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  };
}

function inputDifference(positive: string, negative: string) {
  const held = (action: string) => ({
    block: {
      type: "bark_convert",
      fields: { TYPE: "number" },
      inputs: {
        VALUE: {
          block: {
            type: "bark_input",
            fields: { ACTION: action, STATE: "held" },
          },
        },
      },
    },
  });
  return {
    block: {
      type: "math_arithmetic",
      fields: { OP: "MINUS" },
      inputs: { A: held(positive), B: held(negative) },
    },
  };
}

export function choicesFor(project: ProjectDocument) {
  return {
    entities: [...project.entities]
      .sort((a, b) => Number(!!b.character) - Number(!!a.character))
      .map((e) => [e.name, e.id] as [string, string]),
    prefabs: project.prefabs.map((p) => [p.id, p.id] as [string, string]),
    actions: Object.keys(project.input).map((a) => [a, a] as [string, string]),
    properties: Object.fromEntries([
      ["", Object.keys(project.properties ?? {})],
      ...project.entities.map((e) => [e.id, Object.keys(e.properties ?? {})]),
    ]),
  };
}
