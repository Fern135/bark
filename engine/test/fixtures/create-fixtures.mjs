// Small original, deterministic assets for testing GLB and texture loading offline.
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const corners = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]];
const faces = [[0, 3, 2], [0, 4, 3], [0, 5, 4], [0, 2, 5], [1, 2, 3], [1, 3, 4], [1, 4, 5], [1, 5, 2]];
const positions = [], normals = [];
for (const face of faces) {
  const [a, b, c] = face.map((i) => corners[i]);
  const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const length = Math.hypot(...n);
  for (const i of face) { positions.push(...corners[i]); normals.push(...n.map((x) => x / length)); }
}
const data = Buffer.from(new Float32Array([...positions, ...normals]).buffer);
const gltf = {
  asset: { version: "2.0", generator: "Bark original fixture" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.95, 0.65, 0.16, 1], metallicFactor: 0, roughnessFactor: 0.7 }, doubleSided: true }],
  buffers: [{ byteLength: data.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length * 4 }, { buffer: 0, byteOffset: positions.length * 4, byteLength: normals.length * 4 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] }, { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" }],
};
const json = Buffer.from(JSON.stringify(gltf)); const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 16 + padded.length + data.length, 8);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(padded.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(data.length); binHeader.writeUInt32LE(0x004e4942, 4);
await writeFile(new URL("gem.glb", import.meta.url), Buffer.concat([header, jsonHeader, padded, binHeader, data]));

function crc32(bytes) { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const tag = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data]))); return Buffer.concat([size, tag, data, crc]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
const pixels = []; for (let y = 0; y < 8; y++) { pixels.push(0); for (let x = 0; x < 8; x++) pixels.push(...((x < 4) === (y < 4) ? [220, 235, 211] : [110, 153, 128])); }
await writeFile(new URL("tile.png", import.meta.url), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(pixels))), chunk("IEND", Buffer.alloc(0))]));
