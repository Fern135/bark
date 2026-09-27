import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createProject, defineEntity } from "../../engine/dist/index.js";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const models = JSON.parse(
  await readFile(resolve(web, "public/models/starter/manifest.json"), "utf8"),
);
const catalog = [
  [
    "woodland-wander",
    "Woodland Wander",
    "#D9F1E5",
    "#9DCB7E",
    [
      [0, 2],
      [-4, 5],
      [4, 8],
      [-3, 11],
      [2, 14],
    ],
  ],
  [
    "cloud-hop",
    "Cloud Hop",
    "#C7EAFE",
    "#91CCAE",
    [
      [0, 5],
      [0, 10],
      [0, 15],
      [0, 20],
    ],
  ],
  [
    "crystal-maze",
    "Crystal Maze",
    "#C3BBE9",
    "#7978AC",
    [
      [-5, 5],
      [5, 10],
      [0, 16],
    ],
  ],
  [
    "moon-bounce",
    "Moon Bounce",
    "#252F57",
    "#AFAAD1",
    [
      [0, 7],
      [0, 14],
      [0, 21],
      [0, 28],
    ],
  ],
  [
    "rainbow-rally",
    "Rainbow Rally",
    "#DCEFFF",
    "#ABD9DB",
    [
      [0, 3],
      [-4, 8],
      [4, 13],
      [-4, 18],
      [0, 24],
    ],
  ],
  [
    "garden-quest",
    "Garden Quest",
    "#F3EFE0",
    "#AED68E",
    [
      [-4, 3],
      [5, 5],
      [-5, 9],
      [4, 12],
      [0, 16],
    ],
  ],
];
await mkdir(resolve(web, "public/games/data"), { recursive: true });
for (const [slug, title, background, groundColor, points] of catalog) {
  const project = createProject(title);
  const moon = slug === "moon-bounce",
    platforms = moon || slug === "cloud-hop",
    race = slug === "rainbow-rally",
    maze = slug === "crystal-maze";
  project.settings = {
    ...project.settings,
    background,
    ambientIntensity: 0.65,
    sunIntensity: 0.8,
    gravity: { x: 0, y: moon ? -4 : -9.81, z: 0 },
  };
  project.cameras = {
    ...project.cameras,
    active: "follow",
    targetId: "player",
    offset: { x: 0, y: 9, z: -11 },
  };
  const assetNames = new Set();
  function model(key, id, x, z, scale = 1) {
    assetNames.add(key);
    const size = models[key].size;
    return defineEntity({
      id,
      name: key === "player" ? "Little explorer" : key,
      tags: [`starter:${key}`],
      transform: {
        position: { x, y: (size.y * scale) / 2 + 0.03, z },
        scale: { x: scale, y: scale, z: scale },
      },
      visual: { kind: "model", assetId: key },
      ...(key === "player"
        ? {
            collider: { shape: "capsule", size: { x: 1, y: 2, z: 1 } },
            body: { mode: "dynamic", rotationLocked: true, restitution: 0 },
            character: { speed: race ? 7 : 5, jumpSpeed: moon ? 5 : 6 },
          }
        : {}),
    });
  }
  function box(id, x, y, z, sx, sy, sz, color, solid = true) {
    return defineEntity({
      id,
      name: id,
      tags: id.startsWith("ground") ? ["ground"] : [],
      transform: { position: { x, y, z } },
      visual: { kind: "box", size: { x: sx, y: sy, z: sz }, color },
      ...(solid
        ? {
            collider: { size: { x: sx, y: sy, z: sz } },
            body: { mode: "static" },
          }
        : {}),
    });
  }
  project.entities = [model("player", "player", 0, -1)];
  if (platforms) {
    const gap = moon ? 7 : 5;
    for (let i = 0; i <= 4; i++) {
      project.entities.push(
        box(`ground-island-${i}`, 0, -0.45, i * gap, 5, 0.9, 3.6, groundColor),
      );
      project.entities.push(
        box(
          `island-base-${i}`,
          0,
          -1.2,
          i * gap,
          4.4,
          0.7,
          3.1,
          moon ? "#817BA8" : "#B59B7D",
          false,
        ),
      );
      project.entities.push(
        model(moon ? "rock" : "bush", `island-decor-${i}`, 1.8, i * gap, 0.65),
      );
    }
  } else {
    project.entities.push(box("ground", 0, -0.5, 11, 18, 1, 32, groundColor));
    project.entities.push(
      box("island-earth", 0, -1.4, 11, 18.3, 1.1, 32.3, "#BBA685", false),
    );
    for (let i = 0; i < 15; i++) {
      project.entities.push(
        model(
          slug === "garden-quest" ? "flower" : maze ? "rock" : "tree",
          `decor-${i}`,
          (i % 2 ? -1 : 1) * 7.6,
          -2 + Math.floor(i / 2) * 4,
          maze ? 1 : 0.8,
        ),
      );
      if (!race && !maze)
        project.entities.push(
          box(
            `path-${i}`,
            Math.sin(i) * 1.4,
            0.015,
            i * 2 - 2,
            2.5,
            0.03,
            2,
            "#DDD0A6",
            false,
          ),
        );
    }
    if (maze)
      for (const [i, z] of [3, 8, 13].entries())
        project.entities.push(
          box(
            `maze-wall-${i}`,
            i % 2 ? -2 : 2,
            1.9,
            z,
            12,
            3.8,
            0.65,
            i % 2 ? "#A494D5" : "#9585C4",
          ),
        );
    if (slug === "garden-quest")
      for (let i = 0; i < 5; i++)
        project.entities.push(
          model("bush", `hedge-${i}`, points[i][0] + 1.5, points[i][1], 1.4),
        );
    if (race)
      points.forEach(([x, z], i) => {
        const color = ["#F3ABBD", "#EBC774", "#AADEA2", "#91CFF0", "#C3B0EF"][
          i
        ];
        project.entities.push(
          box(`checkpoint-path-${i}`, x, 0.025, z, 4, 0.05, 3, color, false),
        );
        project.entities.push(
          box(`gate-left-${i}`, x - 1.8, 1.5, z, 0.25, 3, 0.25, color),
        );
        project.entities.push(
          box(`gate-right-${i}`, x + 1.8, 1.5, z, 0.25, 3, 0.25, color),
        );
        project.entities.push(
          box(`gate-top-${i}`, x, 3, z, 3.85, 0.3, 0.3, color, false),
        );
      });
  }
  points.forEach(([x, z], i) => {
    const entity = model("gem", `goal-${i}`, x, z, 0.75);
    entity.name = race ? `Checkpoint ${i + 1}` : `Treasure ${i + 1}`;
    project.entities.push(entity);
  });
  project.assets = [...assetNames].map((key) => ({
    id: key,
    type: "model",
    url: `/models/starter/${key}.glb`,
  }));
  const source = `from bark import game

player = game.entity("player")
goals = ${JSON.stringify(points)}
collected = set()
finished = False

@game.on_input("jump")
async def jump(state):
    if state.pressed:
        await player.jump()

@game.on_start
async def adventure():
    global finished
    await game.set_hud("progress", "${race ? "Checkpoints" : "Treasures"}", "0 / ${points.length}")
    await game.notify("${race ? "Follow the checkpoints in order!" : platforms ? "Jump across the gaps. Find every crystal!" : "Find every treasure. Let curiosity lead!"}", 4)
    while True:
        right = await game.input("right")
        left = await game.input("left")
        forward = await game.input("forward")
        backward = await game.input("backward")
        await player.walk(int(right.held) - int(left.held), int(forward.held) - int(backward.held))
        position = await player.position()
        if position.y < -8:
            await player.respawn()
        if not finished:
            ${race ? 'await game.set_hud("time", "Time", str(round(game.elapsed, 1)) + "s")' : "pass"}
            for index, goal in enumerate(goals):
                if index in collected${race ? " or index != len(collected)" : ""}:
                    continue
                if (position.x - goal[0]) ** 2 + (position.z - goal[1]) ** 2 < 1.5 ** 2 and -1 < position.y < 3:
                    collected.add(index)
                    await game.entity("goal-" + str(index)).destroy()
                    await game.set_hud("progress", "${race ? "Checkpoints" : "Treasures"}", str(len(collected)) + " / ${points.length}")
                    if len(collected) == len(goals):
                        finished = True
                        await game.set_hud("result", "Adventure", "Complete!")
                        await game.notify("You did it! Restart for another adventure.", 12)
                    else:
                        await game.notify("${race ? "Checkpoint reached!" : "Found one! Keep exploring."}", 2)
        await game.next_frame()
`;
  await writeFile(
    resolve(web, `public/games/data/${slug}.json`),
    JSON.stringify(
      { version: 1, project, script: { language: "python", source } },
      null,
      2,
    ) + "\n",
  );
}
console.log("Created six playable marketplace JSON games.");
