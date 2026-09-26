import gemUrl from "./fixtures/gem.glb?url";
import tileUrl from "./fixtures/tile.png?url";
import { createProject, defineEntity } from "../src/index.js";
import type { EntityDefinition, ProjectDocument, Vec3 } from "../src/index.js";

const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
function box(id: string, position: Vec3, size: Vec3, color: string): EntityDefinition {
  return defineEntity({ id, name: id, transform: { position }, visual: { kind: "box", size, color }, collider: { shape: "box", size }, body: { mode: "static" } });
}
export function sampleProject(alternate = false): ProjectDocument {
  const p = createProject(alternate ? "Physics workshop" : "Collect & explore");
  p.assets = [{ id: "gem", type: "model", url: gemUrl }, { id: "tile", type: "texture", url: tileUrl }];
  p.materials = [{ id: "checker", color: "#FFFFFF", textureId: "tile" }, { id: "mint", color: "#98DFC0" }];
  p.properties = { coins: 0 };
  p.cameras = { ...p.cameras, active: "follow", targetId: "player", offset: vec(0, 5, -9) };
  const floor = box("floor", vec(0, -0.5, 2), vec(26, 1, 26), "#405D4E");
  p.entities = [floor,
    defineEntity({ id: "player", name: "Player", tags: ["player"], transform: { position: vec(0, 1.05, -5) }, visual: { kind: "capsule", size: vec(1, 2, 1), color: "#B8EAC1" }, collider: { shape: "capsule", size: vec(1, 2, 1) }, body: { rotationLocked: true, restitution: 0, friction: 0 }, character: {} }),
    box("step", vec(3, 0.4, 2), vec(3, 0.8, 3), "#849D8E"),
    box("platform", vec(6, 1, 4), vec(3, 2, 3), "#738577"),
    defineEntity({ id: "sign", name: "Interact with E", tags: ["interactable"], transform: { position: vec(-3, 1, -1) }, visual: { kind: "box", size: vec(1.2, 2, 0.4), materialId: "checker" }, collider: { shape: "box", size: vec(1.2, 2, 0.4) }, body: { mode: "static" }, interaction: { prompt: "Read sign · E" } }),
    defineEntity({ id: "goal", name: "Goal trigger", tags: ["goal"], transform: { position: vec(0, 0.15, 7) }, visual: { kind: "box", size: vec(4, 0.2, 2), color: "#9DC3E3" }, collider: { shape: "box", size: vec(4, 3, 2), trigger: true }, body: { mode: "static" } }),
  ];
  for (let i = 0; i < 3; i++) p.entities.push(defineEntity({ id: `gem-${i}`, name: `Coin ${i + 1}`, tags: ["collectible"], transform: { position: vec(i === 1 ? 3 : 0, 1.4, -2 + i * 2), scale: vec(0.5, 0.5, 0.5) }, visual: { kind: "model", assetId: "gem" }, collider: { shape: "sphere", size: vec(2, 2, 2), trigger: true }, body: { mode: "static" } }));
  p.entities.push(defineEntity({ id: "door", name: "Locked door", tags: ["door"], properties: { requiredCoins: 3, open: false }, transform: { position: vec(0, 1.5, 4.5) }, visual: { kind: "box", size: vec(4, 3, 0.4), color: "#916F55" }, collider: { shape: "box", size: vec(4, 3, 0.4) }, body: { mode: "kinematic" }, interaction: { prompt: "Open door · E" } }));
  p.entities.push(defineEntity({ id: "checkpoint", name: "Garden checkpoint", tags: ["checkpoint"], properties: { active: false }, transform: { position: vec(0, 0.1, 6) }, visual: { kind: "box", size: vec(2, 0.2, 1), color: "#D9A6EF" }, collider: { shape: "box", size: vec(2, 2, 1), trigger: true } }));
  p.entities.push(defineEntity({ id: "arch", name: "Arch group", transform: { position: vec(0, 0, 7) } }));
  for (const [id, pos, size] of [["arch-left", vec(-2.5, 1.5, 0), vec(0.3, 3, 0.3)], ["arch-right", vec(2.5, 1.5, 0), vec(0.3, 3, 0.3)], ["arch-top", vec(0, 3, 0), vec(5.3, 0.3, 0.3)]] as const) p.entities.push(defineEntity({ id, name: id, parentId: "arch", transform: { position: pos }, visual: { kind: "box", size, color: "#ADC6B4" } }));
  p.prefabs = [{ id: "totem", entities: [defineEntity({ id: "root", name: "Totem" }), defineEntity({ id: "base", name: "Pedestal", parentId: "root", visual: { kind: "box", size: vec(1, 1, 1), materialId: "checker" }, transform: { position: vec(0, 0.5, 0) } }), defineEntity({ id: "gem", name: "Gem ornament", parentId: "root", visual: { kind: "model", assetId: "gem" }, transform: { position: vec(0, 2, 0) } })] }];
  if (alternate) {
    p.settings.background = "#172137";
    p.entities = p.entities.filter((e) => ["floor", "player", "sign"].includes(e.id));
    for (let i = 0; i < 6; i++) p.entities.push(defineEntity({ id: `drop-${i}`, name: `Falling ${i % 2 ? "ball" : "box"}`, transform: { position: vec(-3 + i, 4 + i, 2) }, visual: { kind: i % 2 ? "sphere" : "box", size: vec(1, 1, 1), color: "#EBBE82" }, collider: { shape: i % 2 ? "sphere" : "box" }, body: {} }));
  }
  return p;
}
