// Original rounded Bark meshes. No external models or textures are required.
// Run with node web/scripts/prepare-toy-models.mjs; thumbnails use the live engine.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const output = fileURLToPath(new URL("../public/models/toys/", import.meta.url));
mkdirSync(output, { recursive: true });
const manifest = {};
const colors = {
  orange: "#ED792B", cream: "#FFF1DC", navy: "#15233F", white: "#FFFFFF",
  pink: "#F87593", blue: "#428BD6", gold: "#FFCB35", wood: "#96522B",
  leaf: "#439650", lightLeaf: "#63AF51", darkLeaf: "#24784D", rock: "#9497A3",
};

function model(id, height, build) {
  const doc = { asset: { version: "2.0", generator: "Bark original toy models" }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ name: id, children: [] }], meshes: [], materials: [],
    accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  const chunks = [];
  let bytes = 0;
  const materials = new Map();
  const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  function accessor(array, type, count, min, max) {
    const buffer = Buffer.from(array.buffer);
    const view = doc.bufferViews.push({ buffer: 0, byteOffset: bytes, byteLength: buffer.length }) - 1;
    chunks.push(buffer); bytes += buffer.length;
    const padding = (4 - bytes % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); bytes += padding; }
    return doc.accessors.push({ bufferView: view, componentType: array instanceof Float32Array ? 5126 : 5123,
      count, type, ...(min ? { min, max } : {}) }) - 1;
  }
  const vertices = [], normals = [], indices = [];
  const rings = 24, segments = 32;
  for (let y = 0; y <= rings; y++) for (let x = 0; x <= segments; x++) {
    const theta = Math.PI * y / rings, phi = 2 * Math.PI * x / segments;
    const v = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
    vertices.push(...v); normals.push(...v);
    if (y < rings && x < segments) {
      const a = y * (segments + 1) + x, b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const position = accessor(new Float32Array(vertices), "VEC3", vertices.length / 3, [-1, -1, -1], [1, 1, 1]);
  const normal = accessor(new Float32Array(normals), "VEC3", normals.length / 3);
  const index = accessor(new Uint16Array(indices), "SCALAR", indices.length);
  function ellipsoid(name, at, radius, color, rotation = 0, gloss = false) {
    const key = color + gloss;
    if (!materials.has(key)) {
      const rgb = color.replace("#", "").match(/../g).map((c) => {
        const value = parseInt(c, 16) / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      materials.set(key, doc.materials.push({ name: key, pbrMetallicRoughness: {
        baseColorFactor: [...rgb, 1], metallicFactor: 0, roughnessFactor: gloss ? .2 : .72,
      } }) - 1);
    }
    const mesh = doc.meshes.push({ name, primitives: [{ attributes: { POSITION: position, NORMAL: normal },
      indices: index, material: materials.get(key) }] }) - 1;
    doc.nodes[0].children.push(doc.nodes.push({ name, mesh, translation: at, scale: radius,
      rotation: [0, 0, Math.sin(rotation / 2), Math.cos(rotation / 2)] }) - 1);
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const extent = [Math.hypot(radius[0] * c, radius[1] * s), Math.hypot(radius[0] * s, radius[1] * c), radius[2]];
    for (let k = 0; k < 3; k++) { bounds[0][k] = Math.min(bounds[0][k], at[k] - extent[k]); bounds[1][k] = Math.max(bounds[1][k], at[k] + extent[k]); }
  }
  build(ellipsoid);
  const scale = height / (bounds[1][1] - bounds[0][1]);
  doc.nodes[0].scale = [scale, scale, scale];
  doc.nodes[0].translation = bounds[0].map((n, k) => -(n + bounds[1][k]) / 2 * scale);
  doc.buffers[0].byteLength = bytes;
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + bytes, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binaryHeader = Buffer.alloc(8); binaryHeader.writeUInt32LE(bytes); binaryHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(`${output}/${id}.glb`, Buffer.concat([header, json, binaryHeader, ...chunks]));
  manifest[id] = { file: `${id}.glb`, source: "Bark original rounded meshes", size: {
    x: (bounds[1][0] - bounds[0][0]) * scale, y: height, z: (bounds[1][2] - bounds[0][2]) * scale,
  } };
}

model("player", 2, (part) => {
  part("body", [0, .63, .05], [.46, .55, .45], colors.orange);
  part("chest", [0, .64, -.32], [.32, .39, .13], colors.cream);
  for (const side of [-1, 1]) {
    part("haunch", [side * .36, .32, .14], [.28, .32, .3], colors.orange);
    part("back paw", [side * .39, .12, .08], [.19, .12, .23], colors.cream);
    part("front leg", [side * .23, .34, -.28], [.13, .32, .13], colors.cream);
    part("paw", [side * .25, .12, -.36], [.2, .13, .24], colors.cream);
  }
  part("tail", [.5, .52, .34], [.34, .13, .13], colors.orange, .7);
  part("collar", [0, 1.05, -.015], [.44, .105, .37], colors.blue);
  part("tag rim", [0, .95, -.405], [.11, .13, .035], colors.blue, 0, true);
  part("tag", [0, .95, -.435], [.078, .095, .018], colors.cream);
  part("head", [0, 1.56, -.02], [.65, .57, .5], colors.orange);
  part("white blaze", [0, 1.69, -.459], [.12, .34, .068], colors.cream, -.05);
  for (const side of [-1, 1]) {
    part("floppy ear", [side * .65, 1.5, .025], [.25, .43, .23], "#DC722F", side * .3);
    part("eye socket", [side * .275, 1.66, -.442], [.171, .205, .078], colors.navy, side * .06);
    part("eye white", [side * .275, 1.67, -.48], [.152, .183, .067], colors.white, side * .06);
    part("iris", [side * .263, 1.657, -.532], [.12, .148, .048], "#8D4B22", 0, true);
    part("pupil", [side * .253, 1.657, -.566], [.082, .115, .031], colors.navy, 0, true);
    part("eye shine", [side * .253 - .025, 1.713, -.595], [.034, .041, .012], colors.white);
    part("cheek", [side * .235, 1.32, -.44], [.29, .24, .17], colors.cream);
    part("brow", [side * .29, 1.928, -.34], [.115, .038, .04], "#934321", side * -.22);
  }
  part("smile", [0, 1.29, -.52], [.22, .155, .078], colors.navy);
  part("tongue", [.025, 1.21, -.595], [.09, .064, .03], colors.pink);
  for (const side of [-1, 1]) part("muzzle", [side * .13, 1.43, -.54], [.215, .15, .13], colors.cream);
  part("nose", [0, 1.49, -.665], [.135, .085, .065], colors.navy, 0, true);
});

model("tree", 3.6, (part) => {
  part("trunk", [0, .85, 0], [.21, .9, .2], colors.wood, -.06);
  for (const side of [-1, 1]) {
    part("root", [side * .18, .09, 0], [.3, .105, .19], colors.wood);
    part("branch", [side * .3, 1.35, .04], [.13, .65, .13], colors.wood, side * -.65);
  }
  for (const [x, y, z, size, color] of [
    [-.55, 1.8, 0, .65, colors.leaf], [.52, 1.95, .05, .7, colors.leaf],
    [0, 2.15, .25, .78, colors.darkLeaf], [-.3, 2.42, -.1, .67, colors.leaf],
    [.32, 2.5, -.06, .63, colors.lightLeaf], [0, 2.91, .0, .48, colors.leaf],
  ]) part("canopy", [x, y, z], [size, size * .95, size * .8], color);
});
model("bush", .9, (part) => {
  for (const [x, y, z, r] of [[0,.35,0,.45],[-.35,.28,0,.35],[.34,.3,0,.35],[0,.53,.04,.32]]) part("bush", [x,y,z], [r,r,r*.8], colors.leaf);
  for (let i = 0; i < 16; i++) {
    const a = i * 2.4, y = .25 + (i % 3) * .17;
    part("leaf", [Math.cos(a)*.44,y,Math.sin(a)*.3], [.16,.085,.08], i%2 ? colors.lightLeaf : colors.darkLeaf, a);
  }
});
model("flower", .9, (part) => {
  part("stem", [0,.36,0], [.035,.38,.035], colors.darkLeaf, -.06);
  part("leaf", [-.15,.2,0], [.19,.08,.06], colors.leaf, -.6);
  part("leaf", [.15,.28,0], [.19,.08,.06], colors.lightLeaf, .6);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    part("petal", [Math.cos(a)*.17,.72+Math.sin(a)*.17,-.01], [.135,.13,.07], colors.pink);
  }
  part("center", [0,.72,-.075], [.105,.105,.06], colors.gold);
});
model("rock", 1.1, (part) => {
  part("large stone", [-.2,.45,.1], [.64,.56,.5], "#9A9BA4", -.35);
  part("small stone", [.5,.26,-.1], [.43,.31,.4], "#ADB1BC", .25);
  part("front stone", [-.35,.2,-.32], [.42,.26,.3], "#B9BDC5", -.2);
});
model("fence", 1.1, (part) => {
  for (const x of [-.65,.65]) {
    part("post", [x,.55,0], [.1,.55,.1], colors.wood);
    part("cap", [x,1.08,0], [.12,.06,.12], "#AE7246");
  }
  for (const y of [.35,.78]) {
    part("rail", [0,y,-.06], [.87,.115,.06], "#AC693A");
    for (const x of [-.65,.65]) part("nail", [x,y,-.125], [.021,.021,.012], "#D8BD8B");
  }
});
model("bridge", 1, (part) => {
  for (let i = 0; i < 11; i++) {
    const x = (i - 5) * .19, y = .12 + .2 * (1 - (i - 5) ** 2 / 25);
    part("plank", [x,y,0], [.10,.055,.42], i%2 ? "#B57D4A" : "#996238");
  }
  for (const z of [-.43,.43]) for (const x of [-.85,0,.85]) {
    const y = .38 + .2 * (1 - x*x);
    part("post", [x,y,z], [.055,.35,.055], colors.wood);
  }
  for (const z of [-.43,.43]) for (const side of [-1,1]) {
    part("handrail", [side*.44,.78,z], [.5,.055,.055], "#B57D4A", -side*.16);
  }
});
writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Built ${Object.keys(manifest).length} original rounded GLB models.`);
