// Run from web with the two extracted Kenney packs in ../.cache/editor-assets.
// Normalize static presentation while retaining the original meshes and animations.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "public/models/starter");
mkdirSync(output, { recursive: true });
const entries = [
  ["player", "platformer", "character-oopi", 2],
  ["tree", "nature", "tree_detailed", 3.6],
  ["rock", "nature", "rock_largeA", 1.1],
  ["crate", "platformer", "crate", 1.2],
  ["gem", "platformer", "jewel", 0.8],
  ["flag", "platformer", "flag", 2.2],
  ["platform", "nature", "platform_stone", 0.5],
  ["flower", "nature", "flower_yellowC", 0.75],
  ["bridge", "nature", "bridge_wood", 1],
  ["bush", "nature", "plant_bushDetailed", 0.9],
  ["fence", "nature", "fence_planks", 1.1],
  ["mushroom", "nature", "mushroom_redGroup", 0.6],
  ["pine", "nature", "tree_pineRoundA", 3.7],
  ["tent", "nature", "tent_detailedOpen", 2],
  ["sign", "nature", "sign", 1.5],
  ["robot", "platformer", "character-oodi", 1.8],
];
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) =>
  Array.from({ length: 16 }, (_, i) => {
    const r = i % 4,
      c = Math.floor(i / 4);
    return [0, 1, 2, 3].reduce((v, k) => v + a[k * 4 + r] * b[c * 4 + k], 0);
  });
function matrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1],
    [a, b, c] = n.scale ?? [1, 1, 1],
    [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * y * y - 2 * z * z) * a,
    (2 * x * y + 2 * z * w) * a,
    (2 * x * z - 2 * y * w) * a,
    0,
    (2 * x * y - 2 * z * w) * b,
    (1 - 2 * x * x - 2 * z * z) * b,
    (2 * y * z + 2 * x * w) * b,
    0,
    (2 * x * z + 2 * y * w) * c,
    (2 * y * z - 2 * x * w) * c,
    (1 - 2 * x * x - 2 * y * y) * c,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}
const manifest = {};
for (const [id, pack, file, height] of entries) {
  const source = path.resolve(
    root,
    `../.cache/editor-assets/${pack}/Models/${pack === "nature" ? "GLTF" : "GLB"} format/${file}.glb`,
  );
  const bytes = readFileSync(source),
    len = bytes.readUInt32LE(12),
    doc = JSON.parse(bytes.subarray(20, 20 + len));
  // Smooth shared surface normals on rounded character/foliage meshes.
  if (["player", "robot", "tree", "bush"].includes(id))
    for (const mesh of doc.meshes)
      for (const primitive of mesh.primitives) {
        const positions = doc.accessors[primitive.attributes.POSITION],
          normals = doc.accessors[primitive.attributes.NORMAL];
        if (
          !normals ||
          positions.componentType !== 5126 ||
          normals.componentType !== 5126
        )
          continue;
        const pv = doc.bufferViews[positions.bufferView],
          nv = doc.bufferViews[normals.bufferView];
        const po =
            28 + len + (pv.byteOffset ?? 0) + (positions.byteOffset ?? 0),
          no = 28 + len + (nv.byteOffset ?? 0) + (normals.byteOffset ?? 0);
        const sums = new Map(),
          keys = [];
        for (let i = 0; i < positions.count; i++) {
          const key = [0, 1, 2]
            .map((k) =>
              bytes
                .readFloatLE(po + i * (pv.byteStride ?? 12) + k * 4)
                .toFixed(5),
            )
            .join(",");
          keys.push(key);
          const sum = sums.get(key) ?? [0, 0, 0];
          for (let k = 0; k < 3; k++)
            sum[k] += bytes.readFloatLE(no + i * (nv.byteStride ?? 12) + k * 4);
          sums.set(key, sum);
        }
        for (let i = 0; i < normals.count; i++) {
          const n = sums.get(keys[i]),
            length = Math.hypot(...n);
          if (length)
            for (let k = 0; k < 3; k++)
              bytes.writeFloatLE(
                n[k] / length,
                no + i * (nv.byteStride ?? 12) + k * 4,
              );
        }
      }
  for (const image of doc.images ?? [])
    if (image.uri && !image.uri.startsWith("data:")) {
      image.uri = `data:image/png;base64,${readFileSync(path.resolve(path.dirname(source), image.uri)).toString("base64")}`;
    }
  // Use the first idle pose rather than shipping the characters in their T-pose.
  const idle = doc.animations?.find((a) => a.name === "idle");
  if (idle)
    for (const channel of idle.channels) {
      const target = channel.target,
        accessor = doc.accessors[idle.samplers[channel.sampler].output];
      const view = doc.bufferViews[accessor.bufferView];
      const offset =
        28 + len + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const size = target.path === "rotation" ? 4 : 3;
      if (["rotation", "translation", "scale"].includes(target.path))
        doc.nodes[target.node][target.path] = Array.from(
          { length: size },
          (_, i) => bytes.readFloatLE(offset + i * 4),
        );
    }
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  function visit(index, parent) {
    const node = doc.nodes[index],
      m = mul(parent, matrix(node));
    if (node.mesh !== undefined)
      for (const p of doc.meshes[node.mesh].primitives) {
        const acc = doc.accessors[p.attributes.POSITION];
        for (let i = 0; i < 8; i++) {
          const v = [0, 1, 2].map((k) =>
            i & (1 << k) ? acc.max[k] : acc.min[k],
          );
          for (let k = 0; k < 3; k++) {
            const n =
              m[k] * v[0] + m[k + 4] * v[1] + m[k + 8] * v[2] + m[k + 12];
            lo[k] = Math.min(lo[k], n);
            hi[k] = Math.max(hi[k], n);
          }
        }
      }
    for (const child of node.children ?? []) visit(child, m);
  }
  const scene = doc.scenes[doc.scene ?? 0];
  scene.nodes.forEach((n) => visit(n, identity()));
  const scale = height / (hi[1] - lo[1]);
  const center = lo.map((v, i) => (v + hi[i]) / 2);
  doc.nodes.push({
    name: "Bark normalized origin",
    children: scene.nodes,
    scale: [scale, scale, scale],
    translation: center.map((n) => -n * scale),
  });
  scene.nodes = [doc.nodes.length - 1];
  if (id === "player" || id === "robot") {
    doc.nodes.push({
      name: "Bark forward orientation",
      children: scene.nodes,
      rotation: [0, 1, 0, 0],
    });
    scene.nodes = [doc.nodes.length - 1];
  }
  for (const material of doc.materials ?? []) {
    const p = (material.pbrMetallicRoughness ??= {});
    p.metallicFactor = 0;
    p.roughnessFactor = 0.82;
    if (/leaf|grass|plant/i.test(material.name))
      p.baseColorFactor = [0.16, 0.4, 0.055, 1];
    if (/wood/i.test(material.name)) p.baseColorFactor = [0.36, 0.17, 0.07, 1];
    if (/stone|rock/i.test(material.name))
      p.baseColorFactor = [0.38, 0.42, 0.49, 1];
  }
  const json = Buffer.from(JSON.stringify(doc)),
    padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const rest = bytes.subarray(20 + len),
    header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + rest.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  writeFileSync(
    path.join(output, `${id}.glb`),
    Buffer.concat([header, padded, rest]),
  );
  manifest[id] = {
    file: `${id}.glb`,
    source: `${pack}/${file}.glb`,
    size: { x: (hi[0] - lo[0]) * scale, y: height, z: (hi[2] - lo[2]) * scale },
  };
}
writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
for (const pack of ["nature", "platformer"])
  copyFileSync(
    path.resolve(root, `../.cache/editor-assets/${pack}/License.txt`),
    path.join(output, `${pack}-license.txt`),
  );
console.log(`Prepared ${entries.length} local models.`);
