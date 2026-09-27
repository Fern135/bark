import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createServer } from "node:http";
import HavokPhysics from "@babylonjs/havok";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Runtime } from "../dist/runtime.js";
import { createProject, defineEntity, validateProject } from "../dist/project.js";
import { Input } from "../dist/input.js";
import { Events } from "../dist/events.js";
import { abortable } from "../dist/assets.js";
import { attachDemo } from "../.validation/test/demo.js";
import { resizeTransform, snap } from "../dist/editor-transform.js";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector.js";

const havok = await HavokPhysics({ wasmBinary: await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url)) });
const v = (x, y, z) => ({ x, y, z });
const size = v(1, 1, 1);
function object(id, shape = "box", position = v(0, 4, 0), extra = {}) {
  return defineEntity({ id, name: id, visual: { kind: shape, size }, collider: { shape, size }, body: {}, transform: { position }, ...extra });
}
function project() {
  const p = createProject("Test world");
  p.entities = [object("floor", "box", v(0, -0.5, 0), { transform: { position: v(0, -0.5, 0), scale: v(30, 1, 30) }, body: { mode: "static" } }), object("box", "box", v(-2, 4, 0)), object("ball", "sphere", v(2, 6, 0))];
  return p;
}
async function fixture(t, p = project(), limits = {}) {
  const engine = new NullEngine(); const runtime = new Runtime(engine, havok, undefined, limits);
  t.after(() => runtime.dispose()); await runtime.load(p);
  return { runtime, engine, step(n = 60) { for (let i = 0; i < n; i++) runtime.advance(1 / 60); } };
}
function near(actual, expected, tolerance = 0.07) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`); }

test("collaborator cameras and transform previews are detached from authored world and physics", async (t) => {
  const { runtime: r } = await fixture(t);
  const original = r.exportProject(), body = r.world.identity("box").body;
  const transform = { ...r.world.get("box").transform, position: v(12, 4, 0) };
  const peer = { id: "peer", color: "#7555dd", camera: { position: v(4, 5, 6), target: v(0, 0, 0) }, selected: "box", preview: { id: "box", transform } };
  r.editorTools.presence([peer]);
  const meshes = r.current.scene.meshes.filter((mesh) => mesh.name.startsWith("presence:"));
  assert.equal(meshes.length, 2);
  assert.ok(meshes.every((mesh) => !mesh.isPickable));
  assert.equal(r.world.get("box").transform.position.x, 12);
  r.editorTools.presence([{ ...peer, camera: { ...peer.camera, position: v(8, 5, 6) } }]);
  assert.deepEqual(r.exportProject(), original);
  assert.equal(r.world.identity("box").body, body);
  assert.equal(r.current.scene.meshes.filter((mesh) => mesh.name.startsWith("presence:")).length, 2);
  const pose = r.cameras.pose(); pose.position.x = 999;
  assert.notEqual(r.cameras.pose().position.x, 999);
  r.editorTools.presence([]);
  assert.equal(r.world.get("box").transform.position.x, -2);
  assert.ok(meshes.every((mesh) => mesh.isDisposed()));
  r.editorTools.presence([peer]);
  r.world.update("ball", { name: "Still authored" });
  assert.equal(r.exportProject().entities.find((e) => e.id === "box").transform.position.x, -2);
  r.editorTools.presence([peer]);
  r.transforms.set("box", { position: v(7, 4, 0) });
  r.editorTools.presence([]);
  assert.equal(r.world.get("box").transform.position.x, 7);
  r.editorTools.presence([peer]);
  r.play();
  assert.equal(r.world.get("box").transform.position.x, 7);
});

test("unchanged collaboration leases do not detach an active camera gesture", async (t) => {
  const { runtime: r } = await fixture(t);
  r.editorTools.configure({ enabled: true, selected: "box" });
  const camera = r.current.cameras.editor;
  assert.equal(camera.movement.input.getEntry("pointer", "rotate", { modifiers: {} }).button, 2);
  let detachments = 0;
  const detach = camera.detachControl.bind(camera);
  camera.detachControl = () => { detachments++; detach(); };
  r.editorTools.configure({ enabled: true, selected: "box" });
  assert.equal(detachments, 0);
  r.current.tools.begin();
  assert.equal(detachments, 1);
  r.editorTools.configure({ enabled: true, selected: "box" });
  assert.equal(detachments, 1);
  r.editorTools.cancel();
  assert.equal(detachments, 2);
  r.editorTools.configure({ enabled: false });
  assert.equal(detachments, 2);
  assert.equal(camera.movement.input.getEntry("pointer", "rotate", { modifiers: {} }).button, 2);
});

test("face resizing anchors rotated off-center bounds and supports center, uniform, snap and minimum size", () => {
  const q = Quaternion.RotationYawPitchRoll(0.8, 0.3, 0);
  const start = { position: v(3, 4, 5), rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, scale: v(2, 1, 3) };
  const bounds = { min: new Vector3(1, -1, -2), max: new Vector3(3, 3, 2) };
  const world = (t, point) => Vector3.TransformCoordinates(point, Matrix.Compose(new Vector3(t.scale.x, t.scale.y, t.scale.z), new Quaternion(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w), new Vector3(t.position.x, t.position.y, t.position.z)));
  for (const side of [-1, 1]) for (const centered of [false, true]) for (const uniform of [false, true]) {
    const next = resizeTransform(start, bounds, "x", side, side * snap(1.12, 0.25), uniform, centered, 0.01);
    const anchor = new Vector3(centered ? 2 : side > 0 ? 1 : 3, 1, 0);
    assert.ok(Vector3.Distance(world(start, anchor), world(next, anchor)) < 1e-6);
    near(next.scale.x, centered ? 3 : 2.5, 1e-6);
    near(next.scale.y, uniform ? next.scale.x / 2 : 1, 1e-6);
  }
  const tiny = resizeTransform(start, bounds, "x", 1, -100, true, false, 0.01);
  near(tiny.scale.y, 0.01, 1e-6); assert.equal(snap(0.38, 0.25), 0.5); assert.equal(snap(0.38, 0), 0.38);
});

test("editor preview leaves authored data and physics untouched until one commit, and lifecycle cancels", async (t) => {
  const { runtime: r } = await fixture(t);
  const original = r.exportProject(), events = [];
  r.on("editorTransform", (event) => events.push(event));
  r.editorTools.configure({ enabled: true, selected: "box" });
  const tools = r.current.tools;
  const beforeBody = r.world.identity("box").body;
  tools.begin();
  const moved = { ...r.world.get("box").worldTransform, position: v(3, 4, 0) };
  tools.preview(moved, "5 units");
  assert.deepEqual(r.exportProject(), original);
  assert.deepEqual(r.world.definitions(), original.entities);
  assert.equal(r.world.identity("box").body, beforeBody);
  near(r.world.get("box").worldTransform.position.x, 3);
  r.editorTools.cancel(); near(r.world.get("box").transform.position.x, -2);
  tools.begin(); tools.preview(moved, "5 units"); tools.finish();
  assert.equal(events.filter((event) => event.phase === "commit").length, 1);
  assert.notEqual(r.world.identity("box").body, beforeBody);
  near(r.exportProject().entities.find((e) => e.id === "box").transform.position.x, 3);
  const saved = r.exportProject(); tools.begin(); tools.preview({ ...moved, position: v(20, 4, 0) }, "17 units");
  r.play(); assert.deepEqual(r.exportProject(), saved); r.stop(); near(r.world.get("box").transform.position.x, 3);
  assert.equal(r.exportProject().entities.length, 3);
  tools.begin(); tools.preview({ ...moved, position: v(30, 4, 0) }, "27 units");
  r.world.update("box", { name: "Renamed" });
  near(r.world.get("box").transform.position.x, 3);
  near(r.exportProject().entities.find((e) => e.id === "box").transform.position.x, 3);
});

test("editor preview converts parent space and rejects restricted transforms without losing last valid pose", async (t) => {
  const p = project();
  p.entities.push(defineEntity({ id: "group", transform: { position: v(10, 0, 0), scale: v(2, 2, 2) } }), defineEntity({ id: "child", parentId: "group", visual: { kind: "box", size } }));
  const { runtime: r } = await fixture(t, p);
  const preview = r.world.beginEditorTransform("child");
  const next = { ...r.world.get("child").worldTransform, position: v(14, 2, 0) };
  assert.deepEqual(preview.preview(next).position, v(2, 1, 0)); preview.commit();
  assert.deepEqual(r.world.get("child").transform.position, v(2, 1, 0));
  const sphere = r.world.beginEditorTransform("ball"), original = r.world.get("ball").worldTransform;
  assert.throws(() => sphere.preview({ ...original, scale: v(2, 1, 1) }), /uniform/);
  assert.deepEqual(r.world.get("ball").worldTransform, original); sphere.cancel();
});

test("camera framing includes descendants and preserves the authored document", async (t) => {
  const p = createProject();
  p.entities = [defineEntity({id:"group",transform:{position:v(10,0,0)}}), object("child","box",v(2,1,0),{parentId:"group",body:null,collider:null})];
  const {runtime:r,engine} = await fixture(t,p), authored=r.exportProject();
  r.cameras.frame("group");
  const camera=engine.scenes[0].activeCamera;
  near(camera.target.x,12); near(camera.target.y,1);
  const radius=camera.radius;r.cameras.frame("group",2);assert.ok(camera.radius>radius);
  assert.deepEqual(r.exportProject(),authored);
  assert.throws(()=>r.cameras.frame("group",NaN));
  r.cameras.frame();assert.deepEqual(r.exportProject(),authored);
});

test("subtree destruction cannot cross Stop or delete callback-created replacements", async (t) => {
  const p = createProject(); p.entities = [defineEntity({ id: "parent" }), defineEntity({ id: "child", parentId: "parent" })];
  const { runtime: r } = await fixture(t, p); const authored = r.exportProject(); r.play();
  r.on("entity", (e) => { if (e.action === "destroyed" && e.entityId === "child") r.stop(); }, { scope: "session" });
  assert.equal(r.world.destroy("parent"), false);
  assert.deepEqual(r.exportProject(), authored); assert.equal(r.world.get("child").parentId, "parent");
  r.stop(); r.play();
  r.on("entity", (e) => { if (e.action === "destroyed" && e.entityId === "child") r.world.spawn({ id: "child", parentId: "parent", name: "Replacement" }); }, { scope: "session" });
  assert.equal(r.world.destroy("parent"), false); assert.equal(r.world.get("child").name, "Replacement");
  assert.equal(r.world.get("parent").id, "parent"); r.stop(); assert.deepEqual(r.exportProject(), authored);
});

test("motion cancellation listeners may replace the replacement without stranding handles", async (t) => {
  const { runtime: r, step } = await fixture(t, gameplayProject()); r.play();
  const first = r.motion.glideTo("door", v(1, 2, 3), 1); let nested;
  r.on("motion", (e) => { if (e.actionId === first.id) nested = r.motion.glideTo("door", v(3, 2, 3), 0.1); });
  const second = r.motion.glideTo("door", v(2, 2, 3), 1);
  assert.equal((await first.done).status, "cancelled"); assert.equal((await second.done).status, "cancelled");
  second.cancel(); step(10); assert.equal((await nested.done).status, "completed"); near(r.world.get("door").transform.position.x, 3);
});

test("replacement handles settle when cancellation listeners tear down or change the entity", async (t) => {
  for (const end of [r => r.stop(), r => r.unload(), r => r.dispose(), r => r.load(project()), r => r.world.destroy("door"), r => r.world.update("door", { enabled: false })]) {
    const { runtime: r } = await fixture(t, gameplayProject()); r.play();
    const first = r.motion.glideTo("door", v(1, 2, 3), 1); let pending;
    r.on("motion", (e) => { if (e.actionId === first.id) pending = end(r); }, { scope: "session" });
    const second = r.motion.glideTo("door", v(2, 2, 3), 1);
    assert.equal((await first.done).status, "cancelled"); assert.equal((await second.done).status, "cancelled");
    await pending; second.cancel();
  }
});

test("teardown feedback runs only after cleanup and cannot admit abandoned actions", async (t) => {
  for (const [end, state] of [[r => r.stop(), "editing"], [r => r.unload(), "empty"], [r => r.dispose(), "disposed"], [r => r.load(project()), "loading"]]) {
    const { runtime: r } = await fixture(t, gameplayProject()); r.play();
    const action = r.motion.glideTo("door", v(1, 2, 3), 1); let sessionCalls = 0; const observations = [];
    r.on("feedback", () => { sessionCalls++; r.motion.glideTo("door", v(5, 2, 3), 1); }, { scope: "session" });
    const off = r.on("feedback", () => {
      let code;
      try { r.motion.glideTo("door", v(4, 2, 3), 1); } catch (error) { code = error.code; }
      observations.push({ state: r.state, tick: r.clock.tick, code });
    });
    await end(r); off(); assert.deepEqual(observations, [{ state, tick: 0, code: state === "disposed" ? "DISPOSED" : "INVALID_STATE" }]);
    assert.equal(sessionCalls, 0); assert.equal((await action.done).status, "cancelled");
  }
});

test("a lifecycle listener starting a new session keeps its feedback and actions", async (t) => {
  const { runtime: r, step } = await fixture(t, gameplayProject()); r.play(); let action, restart = true;
  r.on("state", (e) => { if (e.state === "editing" && restart) { restart = false; r.play(); r.feedback.setHud("new", "New session", 1); action = r.motion.glideTo("door", v(2, 3, 4), 0.1); } });
  const snapshots = []; const off = r.on("feedback", (e) => snapshots.push(e));
  r.stop(); assert.equal(r.state, "running"); assert.equal(snapshots.at(-1).hud.new.value, 1);
  step(10); assert.equal((await action.done).status, "completed"); off();
});

test("target delivery tolerates deleting, replacing and removing another character", async (t) => {
  for (const change of [r => r.world.destroy("other"), r => { const e = r.world.get("other"); r.world.destroy("other"); r.world.spawn(e); }, r => r.world.update("other", { character: null })]) {
    const p = gameplayProject(); const other = structuredClone(p.entities.find(e => e.id === "player")); other.id = "other"; other.transform.position.x = 5; p.entities.push(other);
    const { runtime: r, step } = await fixture(t, p); r.play(); let changed = false;
    r.on("target", (e) => { if (e.actorId === "player" && !changed) { changed = true; change(r); } });
    step(2); assert.ok(changed); assert.equal(r.state, "running"); assert.equal(r.clock.tick, 2);
  }
});

test("ground probes and spatial queries honor both sides of collision filtering", async (t) => {
  const p = createProject(); p.entities = [
    defineEntity({ id: "floor", transform: { position: v(0, -0.5, 0) }, collider: { size: v(10, 1, 10), membership: 2, mask: 4 } }),
    defineEntity({ id: "player", transform: { position: v(0, 1.01, 0) }, collider: { shape: "capsule", size: v(1, 2, 1), membership: 1, mask: 2 }, body: { rotationLocked: true }, character: {} }),
  ];
  const { runtime: r, step } = await fixture(t, p); r.play();
  assert.equal(r.physics.grounded("player"), false); assert.equal(r.characters.get("player").grounded, false); assert.equal(r.characters.jump("player"), false);
  assert.equal(r.physics.raycast(v(2, 2, 0), v(2, -2, 0), { membership: 1, mask: 2 }), null);
  const pose = { position: v(2, -0.5, 0), rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: size };
  assert.equal(r.physics.overlap("box", size, pose, { membership: 1, mask: 2 }), null);
  assert.equal(r.physics.overlap("box", size, pose, { membership: 4, mask: 2 }).entityId, "floor");
  r.world.update("floor", { collider: { mask: 1 } });
  assert.equal(r.physics.grounded("player"), true); assert.equal(r.characters.get("player").grounded, true);
  assert.equal(r.characters.jump("player"), true); step(5); assert.ok(r.physics.velocity("player").y > 0);
  assert.throws(() => r.physics.raycast(v(2, 2, 0), v(2, -2, 0), { membership: -1 }), /unsigned/);
});

test("lifecycle separates authored state, pauses time, and restores exact IDs and definitions", async (t) => {
  const { runtime: r, step } = await fixture(t);
  assert.equal(r.state, "editing"); step(); assert.equal(r.clock.tick, 0);
  r.world.update("box", { name: "Edited box", tags: ["test"] }); const authored = r.exportProject();
  r.play(); step(90); assert.ok(r.world.get("box").transform.position.y < 1);
  r.pause(); const time = r.clock; step(600); assert.deepEqual(r.clock, time);
  r.world.destroy("ball"); r.world.spawn(object("temporary"));
  assert.deepEqual(r.exportProject(), authored);
  r.resume(); step(); r.stop(); assert.equal(r.state, "editing"); assert.equal(r.clock.tick, 0);
  assert.deepEqual(r.world.definitions(), authored.entities); assert.deepEqual(r.exportProject(), authored);
  r.unload(); assert.equal(r.state, "empty"); assert.throws(() => r.world, /No world/);
});

test("real Havok collisions, resized colliders, queries and grounding", async (t) => {
  const { runtime: r, step } = await fixture(t); const collisions = [];
  r.on("collision", (e) => collisions.push(e)); r.play(); step(300);
  near(r.world.get("box").transform.position.y, 0.5); near(r.world.get("ball").transform.position.y, 0.5);
  assert.ok(collisions.some((e) => e.phase === "start")); assert.equal(r.physics.grounded("box"), true);
  assert.equal(r.physics.raycast(v(10, 5, 0), v(10, -2, 0)).entityId, "floor");
  r.world.update("ball", { transform: { position: v(2, 5, 0), scale: v(2, 2, 2) } }); step(300); near(r.world.get("ball").transform.position.y, 1);
  const overlap = r.physics.overlap("sphere", size, { position: v(2, 1, 0), rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: size }, { includeTriggers: true });
  assert.equal(overlap.entityId, "ball");
});

test("gravity edits preserve momentum, teleport clears it, mass and static bodies work", async (t) => {
  const { runtime: r, step } = await fixture(t); r.world.destroy("floor");
  r.world.update("ball", { body: { gravityEnabled: false, mass: 2 }, transform: { position: v(0, 10, 0) } });
  r.play(); step(); near(r.world.get("ball").transform.position.y, 10, 0.001);
  r.physics.applyImpulse("ball", v(2, 0, 0)); step(); near(r.world.get("ball").transform.position.x, 1);
  r.world.update("ball", { body: { gravityEnabled: true } }); step(30);
  r.world.update("ball", { body: { gravityEnabled: false } }); const velocity = r.physics.velocity("ball"); step(); near(r.physics.velocity("ball").y, velocity.y, 0.01);
  r.transforms.set("ball", { position: v(0, 10, 0) }); near(r.physics.velocity("ball").y, 0, 0.001);
  r.world.update("ball", { body: { mass: 4 } }); r.physics.applyImpulse("ball", v(2, 0, 0)); step(); near(r.world.get("ball").transform.position.x, 0.5);
  r.world.update("ball", { body: { mode: "static" } }); const fixed = r.world.get("ball").transform;
  r.physics.applyImpulse("ball", v(100, 10, 0)); step(); assert.deepEqual(r.world.get("ball").transform, fixed);
});

test("hierarchy transforms, reparenting, inheritance and validation", async (t) => {
  const { runtime: r } = await fixture(t, createProject());
  const group = r.world.spawn({ name: "Group", transform: { position: v(3, 0, 0), scale: v(2, 2, 2) } });
  const child = r.world.spawn({ parentId: group, transform: { position: v(1, 0, 0) }, tags: ["part"] });
  near(r.world.get(child).worldTransform.position.x, 5);
  assert.deepEqual(r.transforms.toLocal(group, r.transforms.toWorld(group, v(1, 2, 3))), v(1, 2, 3));
  r.transforms.reparent(child, null); near(r.world.get(child).transform.position.x, 5);
  r.transforms.reparent(child, group); near(r.world.get(child).worldTransform.position.x, 5);
  assert.equal(r.world.list({ tag: "part" }).length, 1);
  assert.throws(() => r.transforms.reparent(group, child), /cycle/);
  assert.throws(() => r.world.update(group, { transform: { scale: v(1, 2, 1) } }), /uniform/);
  assert.throws(() => r.world.spawn({ ...object("bad"), parentId: group }), /root/);
  r.world.update(group, { enabled: false }); assert.equal(r.world.get(child).effectiveEnabled, false);
  r.world.destroy(group); assert.equal(r.world.list().length, 0);
});

test("trigger events are delivered after stepping and cleanup emits exit", async (t) => {
  const p = createProject(); p.entities = [object("sensor", "box", v(0, 0, 0), { collider: { shape: "box", size: v(4, 4, 4), trigger: true }, body: { mode: "static" } }), object("ball", "sphere", v(0, 0, 0), { body: { gravityEnabled: false } })];
  const { runtime: r, step } = await fixture(t, p); const events = [];
  r.on("trigger", (e) => { events.push(e); if (e.phase === "enter") r.world.destroy("ball"); });
  r.play(); step(3); assert.ok(events.some((e) => e.phase === "enter")); assert.ok(events.some((e) => e.phase === "exit")); assert.equal(r.world.list().length, 1);
});

test("collision masks exclude contacts and ray hits; disabled colliders disappear", async (t) => {
  const p = createProject(); p.entities = [object("floor", "box", v(0, 0, 0), { body: { mode: "static" }, collider: { membership: 2, mask: 2 } }), object("ball", "sphere", v(0, 3, 0), { collider: { membership: 1, mask: 1 } })];
  const { runtime: r, step } = await fixture(t, p); r.play(); step(120);
  assert.ok(r.world.get("ball").transform.position.y < -1);
  assert.equal(r.physics.raycast(v(0, 5, 0), v(0, -1, 0), { mask: 1 }), null);
  r.world.update("floor", { enabled: false }); assert.equal(r.physics.raycast(v(0, 5, 0), v(0, -1, 0)), null);
});

test("prefab instances have fresh identities and independent state", async (t) => {
  const p = createProject(); p.prefabs = [{ id: "tree", entities: [defineEntity({ id: "root" }), defineEntity({ id: "leaf", parentId: "root", tags: ["leaf"] })] }];
  const { runtime: r } = await fixture(t, p); const a = r.world.spawnPrefab("tree", v(2, 0, 0)); const b = r.world.spawnPrefab("tree", v(-2, 0, 0));
  assert.notEqual(a, b); assert.equal(r.world.children(a).length, 1);
  r.world.update(r.world.children(a)[0].id, { name: "Changed" }); assert.notEqual(r.world.children(b)[0].name, "Changed");
  const exported = r.exportProject(); assert.deepEqual(validateProject(JSON.parse(JSON.stringify(exported))), exported);
  exported.entities[0].transform.position.x = 999; assert.notEqual(r.world.get(a).transform.position.x, 999);
});

test("bounded clock, event ordering and session subscription cleanup", async (t) => {
  const { runtime: r, step } = await fixture(t); const order = []; r.play();
  r.onUpdate(() => order.push("update")); r.on("tick", () => order.push("tick"), { scope: "session" });
  r.advance(10); assert.equal(r.clock.tick, 4); assert.deepEqual(order, Array(4).fill(["update", "tick"]).flat());
  r.pause(); r.advance(10); r.resume(); step(1); assert.equal(r.clock.tick, 5);
  r.stop(); const length = order.length; r.play(); step(); assert.equal(order.length, length);
});

test("invalid projects and edits cannot mutate the current authored world", async (t) => {
  const { runtime: r } = await fixture(t); const original = r.exportProject();
  for (const mutate of [(p) => p.version = 2, (p) => p.entities.push(p.entities[0]), (p) => p.entities[0].transform.scale.x = -1, (p) => p.entities[1].parentId = "missing"]) {
    const p = structuredClone(original); mutate(p); await assert.rejects(r.load(p), { code: "INVALID_ARGUMENT" }); assert.deepEqual(r.exportProject(), original);
  }
  assert.throws(() => r.world.update("ball", { body: { mass: 0 } }), { code: "INVALID_ARGUMENT" });
  assert.throws(() => r.world.update("ball", { transform: { scale: v(1, 2, 1) } }), /uniform/);
  assert.deepEqual(r.exportProject(), original);
});

test("load cancellation, superseding, failed assets and recovery", async (t) => {
  const { runtime: r } = await fixture(t); const original = r.exportProject();
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(r.load(original, { signal: aborted.signal }), { code: "CANCELLED" });
  const first = r.load(createProject("old")); const second = r.load(createProject("new"));
  await assert.rejects(first, { code: "CANCELLED" }); await second; assert.equal(r.exportProject().name, "new");
  const bad = createProject("bad"); bad.assets = [{ id: "bad", type: "model", url: "data:application/octet-stream;base64,AAAA" }];
  await assert.rejects(r.load(bad), { code: "ASSET_LOAD" }); assert.equal(r.state, "error"); assert.equal(r.exportProject().name, "new");
  r.stop(); assert.equal(r.state, "editing");
  const pending = r.load(original); r.dispose(); await assert.rejects(pending, { code: "CANCELLED" }); assert.equal(r.state, "disposed"); r.dispose();
});

test("abortable resources are released when completion arrives after cancellation", async () => {
  let complete; const deferred = new Promise((resolve) => complete = resolve); const controller = new AbortController(); let released = 0;
  const pending = abortable(deferred, controller.signal, () => released++); controller.abort();
  await assert.rejects(pending, { code: "CANCELLED" }); complete({}); await Promise.resolve(); assert.equal(released, 1);
});

test("input samples edges once and clears held actions on pause/blur", () => {
  const input = new Input(undefined, new Events()); input.configure({ jump: ["Space"] }); input.setEnabled(true);
  input.feed("Space", true); input.sample(); assert.deepEqual(input.action("jump"), { pressed: true, held: true, released: false });
  input.sample(); assert.equal(input.action("jump").pressed, false);
  input.feed("Space", false); input.sample(); assert.equal(input.action("jump").released, true);
  input.feed("Space", true); input.clear(); input.sample(); assert.equal(input.action("jump").held, false);
  input.setEnabled(false); input.feed("Space", true); input.sample(); assert.equal(input.action("jump").held, false); input.dispose();
});

test("repeated edits and world swaps keep scene/body counts bounded", async (t) => {
  const { runtime: r, engine } = await fixture(t);
  for (let i = 0; i < 15; i++) r.world.update("box", { visual: { kind: i % 2 ? "box" : "sphere", size }, collider: { shape: i % 2 ? "box" : "sphere" } });
  assert.equal(engine.scenes.length, 1); assert.equal(engine.scenes[0].getPhysicsEngine().getBodies().length, 3);
  assert.equal(engine.scenes[0].meshes.length, 3);
  for (let i = 0; i < 5; i++) { await r.load(project()); r.play(); r.stop(); }
  assert.equal(engine.scenes.length, 1); assert.equal(engine.scenes[0].getPhysicsEngine().getBodies().length, 3);
});

test("camera directions, typed commands, look-at and target deletion", async (t) => {
  const { runtime: r } = await fixture(t);
  r.cameras.set({ active: "follow", targetId: "box", offset: v(0, 5, -9) });
  assert.ok(r.cameras.forward().z > 0.5);
  r.transforms.lookAt("box", v(-2, 4, 3)); near(r.transforms.forward("box").z, 1, 0.001);
  const id = r.dispatch({ type: "spawn", options: { name: "Command entity" } });
  r.dispatch({ type: "move", id, displacement: v(1, 2, 3) }); assert.deepEqual(r.world.get(id).transform.position, v(1, 2, 3));
  assert.equal(r.dispatch({ type: "destroy", id }), true);
  r.world.destroy("box"); assert.equal(r.cameras.get().active, "editor");
});

test("cached GLB instances retain shared assets after another instance is deleted", async (t) => {
  const bytes = await readFile(new URL("./fixtures/gem.glb", import.meta.url));
  const p = createProject(); p.assets = [{ id: "gem", type: "model", url: `data:application/octet-stream;base64,${bytes.toString("base64")}` }];
  p.entities = [defineEntity({ id: "one", visual: { kind: "model", assetId: "gem" } }), defineEntity({ id: "two", visual: { kind: "model", assetId: "gem" }, transform: { position: v(4, 0, 0) } })];
  const { runtime: r, engine } = await fixture(t, p);
  const scene = engine.scenes[0]; const materialCount = scene.materials.length;
  r.world.destroy("one");
  assert.ok(scene.meshes.some((m) => m.metadata?.entityId === "two" && m.getTotalVertices() > 0));
  assert.equal(scene.materials.length, materialCount);
  for (let i = 0; i < 3; i++) { r.play(); r.stop(); }
  assert.equal(scene.materials.length, materialCount);
  assert.equal(r.world.list().length, 1);
});

test("trusted demo uses input to move, jump, collect, interact and restore", async (t) => {
  const p = project();
  p.entities = p.entities.filter((e) => e.id === "floor");
  p.entities.push(object("player", "capsule", v(0, 1.05, -3), { tags: ["player"], visual: { kind: "capsule", size: v(1, 2, 1) }, collider: { shape: "capsule", size: v(1, 2, 1) }, body: { rotationLocked: true, friction: 0, restitution: 0 }, character: {} }));
  p.entities.push(object("gem", "sphere", v(0, 0.5, 0), { tags: ["collectible"], collider: { trigger: true }, body: { mode: "static" } }));
  p.entities.push(object("sign", "box", v(0, 1, 3), { tags: ["interactable"], body: { mode: "static" }, interaction: {} }));
  p.cameras = { ...p.cameras, active: "follow", targetId: "player" };
  const { runtime: r, step } = await fixture(t, p); const messages = [];
  r.play(); attachDemo(r, (message) => messages.push(message)); step(5);
  r.input.feed("Space", true); step(1); r.input.feed("Space", false); step(8);
  assert.ok(r.world.get("player").transform.position.y > 1);
  step(90); r.input.feed("KeyW", true); step(36); r.input.feed("KeyW", false); step(2);
  assert.ok(r.world.get("player").transform.position.z > -1);
  assert.ok(messages.some((m) => m.startsWith("Collected"))); assert.equal(r.world.list({ tag: "collectible" }).length, 0);
  r.input.feed("KeyE", true); step(1); r.input.feed("KeyE", false); step(1);
  assert.ok(messages.some((m) => m.startsWith("Interacted"))); assert.equal(r.properties.get(null, "coins"), 1);
  r.stop(); assert.equal(r.world.list({ tag: "collectible" }).length, 1); near(r.world.get("player").transform.position.z, -3);
});

test("real asset fetches are cached by URL and in-flight abort restores the previous project", async (t) => {
  const bytes = await readFile(new URL("./fixtures/gem.glb", import.meta.url)); let requests = 0, requested;
  const slowRequest = new Promise((resolve) => requested = resolve);
  const server = createServer((req, res) => {
    requests++;
    if (req.url === "/slow") { requested(); return; }
    res.writeHead(200, { "Content-Type": "model/gltf-binary" }); res.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const p = createProject("Cached"); p.assets = [{ id: "first", type: "model", url: `${base}/gem` }, { id: "second", type: "model", url: `${base}/gem` }];
  const { runtime: r, engine } = await fixture(t, p); assert.equal(requests, 1);
  const next = createProject("Cancelled"); next.assets = [{ id: "slow", type: "model", url: `${base}/slow` }];
  const controller = new AbortController(); const load = r.load(next, { signal: controller.signal });
  await slowRequest; controller.abort(); await assert.rejects(load, { code: "CANCELLED" });
  assert.equal(r.state, "editing"); assert.equal(r.exportProject().name, "Cached"); assert.equal(engine.scenes.length, 1);
});

function gameplayProject() {
  const p = createProject("Gameplay test");
  p.entities = [object("floor", "box", v(0, -0.5, 0), { visual: {kind:"box", size:v(30,1,30)}, collider:{size:v(30,1,30)}, body:{mode:"static"} }),
    object("player", "capsule", v(0, 1.05, -3), {tags:["player"], visual:{kind:"capsule",size:v(1,2,1)}, collider:{shape:"capsule",size:v(1,2,1)}, body:{rotationLocked:true,friction:0,restitution:0},character:{}}),
    object("door", "box", v(0, 1.5, 2), {tags:["door"],visual:{kind:"box",size:v(4,3,0.4)},collider:{size:v(4,3,0.4)},body:{mode:"kinematic"},interaction:{prompt:"Open door"},properties:{requiredCoins:1,open:false}})];
  p.cameras={...p.cameras,active:"follow",targetId:"player"}; p.properties={coins:0}; return p;
}

test("gameplay properties are JSON-only, detached, observable and restored", async (t) => {
  const {runtime:r}=await fixture(t); const events=[];
  r.on("property", e=>{ if(e.value && typeof e.value==='object') e.value.tampered=true; });
  r.on("property", e=>events.push(e));
  const input={nested:[1,true,null]}; r.properties.set(null,"score",input); input.nested[0]=99;
  assert.deepEqual(r.properties.get(null,"score"),{nested:[1,true,null]}); assert.equal(events[0].value.tampered,undefined);
  for(const invalid of [NaN,Infinity,undefined,()=>{},new Date(),new Map()]) assert.throws(()=>r.properties.set(null,"bad",invalid));
  const cycle={}; cycle.self=cycle; assert.throws(()=>r.properties.set(null,"bad",cycle),/cycles/);
  r.properties.set("box","door",{locked:true}); const authored=r.exportProject();
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(authored))),authored);
  r.play(); r.properties.set(null,"score",123); r.properties.remove("box","door"); r.stop();
  assert.deepEqual(r.exportProject(),authored); assert.deepEqual(r.properties.get("box","door"),{locked:true});
  const old=project(); delete old.properties; for(const e of old.entities){delete e.properties;delete e.character;delete e.interaction;}
  await r.load(old); assert.deepEqual(r.properties.list(null),{}); assert.deepEqual(r.properties.list("box"),{});
});

test("characters normalize movement, turn without replacing bodies, jump once and respawn", async(t)=>{
  const {runtime:r,engine,step}=await fixture(t,gameplayProject()); r.play(); step(20);
  const body=engine.scenes[0].getPhysicsEngine().getBodies().find(b=>b.transformNode.name==='player');
  assert.equal(r.characters.get("player").grounded,true); assert.equal(r.characters.jump("player"),true); assert.equal(r.characters.jump("player"),false);
  r.characters.move("player",v(1,0,1)); step(1);
  const velocity=r.physics.velocity("player"); near(Math.hypot(velocity.x,velocity.z),5,0.1); assert.ok(velocity.y>5);
  near(r.transforms.forward("player").x,Math.SQRT1_2,0.001);
  assert.equal(engine.scenes[0].getPhysicsEngine().getBodies().find(b=>b.transformNode.name==='player'),body);
  assert.equal(r.characters.jump("player"),false); step(100);
  r.characters.setSpawn("player",{position:v(6,2,0),rotation:{x:0,y:0,z:0,w:1}});
  let respawn=0; r.on("respawn",()=>respawn++); r.characters.respawn("player"); assert.equal(respawn,1);
  near(r.world.get("player").worldTransform.position.x,6); assert.deepEqual(r.physics.velocity("player"),v(0,0,0));
  r.stop(); near(r.characters.get("player").spawn.position.z,-3);
});

test("interaction revalidates distance, obstruction, visibility and enabled settings",async(t)=>{
  const {runtime:r,step}=await fixture(t,gameplayProject()); r.play();
  assert.equal(r.interactions.target("player"),null);
  r.characters.teleport("player",{position:v(0,1,0)}); step(1); assert.equal(r.interactions.target("player"),"door");
  let count=0; r.on("interaction",()=>count++); r.dispatch({type:"interact",id:"door",actorId:"player"}); assert.equal(count,1);
  r.world.spawn(object("blocker","box",v(0,1,1),{body:{mode:"static"}}));
  assert.equal(r.interactions.interact("player","door"),false); assert.equal(count,1); r.world.destroy("blocker");
  r.world.update("door",{visible:false}); assert.equal(r.interactions.target("player"),null);
  r.world.update("door",{visible:true,interaction:{enabled:false,prompt:"Disabled",distance:3}}); assert.equal(r.interactions.target("player"),null);
  r.world.update("door",{interaction:{enabled:true,prompt:"Open",distance:3}}); r.world.update("door",{enabled:false}); assert.equal(r.interactions.target("player"),null);
});

test("kinematic motion uses one body, pauses and completes after pose synchronization",async(t)=>{
  const {runtime:r,engine,step}=await fixture(t,gameplayProject()); r.play(); const world=engine.scenes[0].getPhysicsEngine();
  const body=world.getBodies().find(b=>b.transformNode.name==='door'); let completed;
  r.on("motion",e=>{if(e.status==='completed') completed=r.world.get(e.entityId).worldTransform.position;});
  const action=r.motion.glideTo("door",v(0,5.5,2),1,"easeInOut"); step(30); near(r.world.get("door").worldTransform.position.y,3.5,0.1);
  r.pause(); const position=r.world.get("door").worldTransform.position; step(100); assert.deepEqual(r.world.get("door").worldTransform.position,position);
  r.resume(); step(31); assert.equal((await action.done).status,"completed"); near(completed.y,5.5,0.01);
  assert.equal(world.getBodies().find(b=>b.transformNode.name==='door'),body); step(30); near(r.world.get("door").worldTransform.position.y,5.5,0.01);
  assert.throws(()=>r.motion.glideTo("player",v(0,2,0),1),/Motion requires/);
});

test("actions settle on replacement, edits, destruction, Stop, unload, failure and disposal",async(t)=>{
  const {runtime:r}=await fixture(t,gameplayProject()); r.play();
  let first=r.motion.glideTo("door",v(1,2,3),1); const next=r.motion.rotateTo("door",{x:0,y:1,z:0,w:0},1);
  assert.equal((await first.done).status,"cancelled"); next.cancel(); next.cancel(); assert.equal((await next.done).status,"cancelled");
  for(const change of [{transform:{position:v(0,1.5,2)}},{enabled:false},{body:{mode:"static"}}]) {
    r.stop();r.play();const a=r.motion.glideTo("door",v(1,2,3),1);r.world.update("door",change);assert.equal((await a.done).status,"cancelled");
  }
  r.stop();r.play(); first=r.motion.glideTo("door",v(1,2,3),1);r.world.destroy("door");assert.equal((await first.done).status,"cancelled");
  for(const end of [()=>r.stop(),()=>r.unload(),()=>r.dispose()]) {
    if(r.state==='empty') await r.load(gameplayProject()); else r.stop(); r.play();const a=r.motion.glideTo("door",v(1,2,3),1);end();assert.equal((await a.done).status,"cancelled");
  }
});

test("feedback uses simulation time and limits; Stop clears all session output",async(t)=>{
  const {runtime:r,step}=await fixture(t,gameplayProject(),{notifications:1,actions:1}); r.play();
  r.feedback.setHud("score","Score",{value:2});const snapshot=r.feedback.get();snapshot.hud.score.value.value=9;assert.equal(r.feedback.get().hud.score.value.value,2);
  r.feedback.notify("Hello",1); assert.throws(()=>r.feedback.notify("Too many"),/limit/); step(30);r.pause();step(100);assert.equal(r.feedback.get().notifications.length,1);r.resume();step(31);assert.equal(r.feedback.get().notifications.length,0);
  r.motion.glideTo("door",v(1,3,2),1); const group=r.world.spawn({name:"Group"});assert.throws(()=>r.motion.glideTo(group,v(0,1,0),1),/limit/);
  r.stop();assert.deepEqual(r.feedback.get(),{hud:{},notifications:[],prompt:null});
});

test("placement snaps, rejects penetration, duplicates with fresh IDs and cleans previews",async(t)=>{
  const p=gameplayProject();p.prefabs=[{id:"pair",entities:[defineEntity({id:"root",visual:{kind:"box",size},collider:{size},body:{mode:"static"}}),defineEntity({id:"child",parentId:"root",visual:{kind:"sphere",size},transform:{position:v(0,1,0)}})]}];
  const {runtime:r,engine}=await fixture(t,p); const scene=engine.scenes[0], count=scene.meshes.length, bodies=scene.getPhysicsEngine().getBodies().length;
  const authored=r.exportProject();r.placement.begin({primitive:"box"});assert.equal(r.world.list().length,3);assert.equal(scene.getPhysicsEngine().getBodies().length,bodies);assert.deepEqual(r.exportProject(),authored);
  let preview=r.placement.aim(v(5.2,10,5.3),v(5.2,-2,5.3));assert.equal(preview.valid,true);near(preview.position.x,5);near(preview.position.z,5);near(preview.position.y,0.5);
  r.placement.rotate();assert.equal(r.placement.get().yaw,90);const id=r.placement.commit();assert.equal(r.world.get(id).body.mode,"static");assert.equal(scene.meshes.length,count+1);
  r.placement.begin({primitive:"box"});preview=r.placement.aim(v(0,1,-3),v(0,-2,-3));assert.equal(preview.valid,false);assert.throws(()=>r.placement.commit());r.placement.cancel();
  const root=r.world.spawnPrefab("pair",v(8,1,0));let duplicateIds; r.on("entityDuplicate", (event) => { duplicateIds = event.ids; }); r.placement.begin({duplicateId:root});r.placement.aim(v(-5,10,5),v(-5,-2,5));const copy=r.placement.commit();assert.notEqual(root,copy);assert.equal(duplicateIds[root],copy);assert.equal(Object.keys(duplicateIds).length,2);assert.equal(r.world.children(copy).length,1);assert.notEqual(r.world.children(copy)[0].id,r.world.children(root)[0].id);
  const before=scene.meshes.length;for(let i=0;i<5;i++){r.placement.begin({primitive:"sphere"});r.placement.cancel();}assert.equal(scene.meshes.length,before);
  r.placement.begin({primitive:"box"});r.play();assert.equal(r.placement.get().active,false);assert.throws(()=>r.placement.begin({primitive:"box"}),/editing/);
});

test("entity limits reject entire prefabs and oversized loads without partial edits",async(t)=>{
  const p=gameplayProject();p.prefabs=[{id:"pair",entities:[defineEntity({id:"a"}),defineEntity({id:"b",parentId:"a"})]}];
  const {runtime:r}=await fixture(t,p,{entities:4}); const before=r.exportProject();
  assert.throws(()=>r.world.spawnPrefab("pair"),/limit/);assert.deepEqual(r.exportProject(),before);
  assert.throws(()=>r.placement.begin({prefabId:"pair"}),/limit/);const larger=structuredClone(p);larger.entities.push(defineEntity({id:"four"}),defineEntity({id:"five"}));
  await assert.rejects(r.load(larger),/limit/);assert.deepEqual(r.exportProject(),before);
});

test("full demo collects, unlocks a timed door, checkpoints, respawns and restores",async(t)=>{
  const p=gameplayProject();p.entities.push(object("coin","sphere",v(0,1,0),{tags:["collectible"],collider:{trigger:true},body:{mode:"static"}}));
  p.entities.push(defineEntity({id:"checkpoint",name:"Checkpoint",tags:["checkpoint"],transform:{position:v(0,0,5)},collider:{shape:"box",size:v(2,2,2),trigger:true},properties:{active:false}}));
  const {runtime:r,step}=await fixture(t,p);const authored=r.exportProject();r.play();attachDemo(r);step(10);
  r.characters.teleport("player",{position:v(0,1,0)});step(2);assert.equal(r.properties.get(null,"coins"),1);assert.equal(r.feedback.get().hud.coins.value,1);
  assert.equal(r.interactions.interact("player","door"),true);step(100);near(r.world.get("door").worldTransform.position.y,5.5,0.01);
  assert.ok(r.feedback.get().notifications.some(n=>n.text.includes("Door open")));
  r.characters.teleport("player",{position:v(0,1,5)});step(2);assert.equal(r.properties.get("checkpoint","active"),true);
  r.characters.teleport("player",{position:v(0,-13,10)});step(1);near(r.world.get("player").worldTransform.position.z,5);
  r.stop();assert.deepEqual(r.exportProject(),authored);assert.equal(r.world.list({tag:"collectible"}).length,1);near(r.world.get("door").worldTransform.position.y,1.5);
});

test("Stop during completion delivery prevents stale completions and ticks",async(t)=>{
  const {runtime:r,step}=await fixture(t,gameplayProject());const id=r.world.spawn({});r.play();let ticks=0,completions=0;
  r.on("motion",e=>{if(e.status==='completed'){completions++;r.stop();}});r.on("tick",()=>ticks++);
  const a=r.motion.glideTo("door",v(0,3,2),1/60),b=r.motion.glideTo(id,v(1,0,0),1/60);step(1);
  assert.equal((await a.done).status,"completed");assert.equal((await b.done).status,"cancelled");assert.equal(completions,1);assert.equal(ticks,0);assert.equal(r.clock.tick,0);
});

test("camera picking rays stay centered at different render scales",async(t)=>{
  const {runtime:r,engine}=await fixture(t);const forward=r.cameras.forward();
  for(const scale of [0.5,0.8,1,2]){engine.setHardwareScalingLevel(scale);const ray=r.cameras.ray(0,0),d=v(ray.to.x-ray.from.x,ray.to.y-ray.from.y,ray.to.z-ray.from.z),len=Math.hypot(d.x,d.y,d.z);near(d.x/len,forward.x,0.001);near(d.y/len,forward.y,0.001);near(d.z/len,forward.z,0.001);}
});

test("ground probes accept gentle slopes and reject steep faces and triggers",async(t)=>{
  const p=gameplayProject();p.entities=p.entities.filter(e=>e.id==='player');
  const angle=Math.PI/6;p.entities.push(object("ramp","box",v(0,-0.58,-3),{visual:{kind:"box",size:v(8,1,8)},collider:{size:v(8,1,8)},transform:{position:v(0,-0.58,-3),rotation:{x:0,y:0,z:Math.sin(angle/2),w:Math.cos(angle/2)}},body:{mode:"static"}}));
  const {runtime:r}=await fixture(t,p);assert.equal(r.characters.get("player").grounded,true);
  r.world.update("player",{character:{slopeLimit:15}});assert.equal(r.characters.get("player").grounded,false);
  r.world.update("player",{character:{slopeLimit:50}});r.world.update("ramp",{collider:{trigger:true}});assert.equal(r.characters.get("player").grounded,false);
});

test("kinematic movement pushes dynamic objects instead of teleporting through them",async(t)=>{
  const p=gameplayProject();p.entities=p.entities.filter(e=>e.id!=='player');p.cameras.targetId=null;
  p.entities.push(object("crate","box",v(0,0.5,3),{body:{friction:0,restitution:0}}));
  const {runtime:r,step}=await fixture(t,p);r.play();const a=r.motion.glideTo("door",v(0,1.5,5),1);step(70);
  assert.equal((await a.done).status,"completed");assert.ok(r.world.get("crate").worldTransform.position.z>5);
});

test("motion easings, rotation, appearance edits and lifecycle failures settle correctly",async(t)=>{
  const {runtime:r,step}=await fixture(t,gameplayProject());r.play();
  const action=r.motion.glideTo("door",v(0,5.5,2),1,"easeIn");step(30);near(r.world.get("door").worldTransform.position.y,2.5,0.03);
  r.world.update("door",{body:{friction:0.1},visual:{kind:"box",size:v(4,3,0.4),color:"#FFFFFF"}});step(31);assert.equal((await action.done).status,"completed");
  const rotate=r.motion.rotateTo("door",{x:0,y:1,z:0,w:0},0.5);step(31);assert.equal((await rotate.done).status,"completed");near(Math.abs(r.world.get("door").worldTransform.rotation.y),1,0.001);
  const duringLoad=r.motion.glideTo("door",v(0,2,2),10);await r.load(gameplayProject());assert.equal((await duringLoad.done).status,"cancelled");
  r.play();const failed=r.motion.glideTo("door",v(0,2,2),10);r.onUpdate(()=>{throw new Error("test callback failure");});step(1);assert.equal(r.state,"error");assert.equal((await failed.done).status,"cancelled");r.stop();
  r.play();const unloading=r.motion.glideTo("door",v(0,2,2),10);const loading=r.load({...gameplayProject(),assets:[{id:"bad",type:"model",url:"data:invalid"}]});await assert.rejects(loading);assert.equal((await unloading.done).status,"cancelled");r.stop();
});

test("Stop during contact delivery drops stale contacts and resets feedback",async(t)=>{
  const p=gameplayProject();p.entities.push(object("trigger-a","sphere",v(0,1,-3),{collider:{trigger:true},body:{mode:"static"}}),object("trigger-b","sphere",v(0,1,-3),{collider:{trigger:true},body:{mode:"static"}}));
  const {runtime:r,step}=await fixture(t,p);r.play();let calls=0;r.on("trigger",()=>{calls++;r.stop();},{scope:"session"});step(1);assert.equal(calls,1);assert.equal(r.clock.tick,0);assert.equal(r.state,"editing");
});

test("placement includes collider bounds, ground fallback and cached model preview ownership",async(t)=>{
  const bytes=await readFile(new URL("./fixtures/gem.glb",import.meta.url));const p=createProject();
  p.assets=[{id:"gem",type:"model",url:`data:application/octet-stream;base64,${bytes.toString('base64')}`}];
  p.prefabs=[{id:"large",entities:[defineEntity({id:"root",visual:{kind:"model",assetId:"gem"},collider:{shape:"box",size:v(4,4,4)},body:{mode:"static"}})]}];
  const {runtime:r,engine}=await fixture(t,p);const scene=engine.scenes[0];let materials;
  for(let i=0;i<4;i++) {r.placement.begin({prefabId:"large"});r.placement.configure({grid:0.5});const preview=r.placement.aim(v(5.2,10,0),v(5.2,-10,0));assert.equal(preview.valid,true);near(preview.position.x,5);near(preview.position.y,2);r.placement.cancel();materials ??= scene.materials.length;assert.equal(scene.materials.length,materials);}
  r.placement.begin({prefabId:"large"});r.placement.aim(v(0,10,0),v(0,-10,0));const id=r.placement.commit();near(r.world.get(id).transform.position.y,2);assert.equal(r.world.get(id).visual.assetId,"gem");
  r.placement.begin({primitive:"box"});r.placement.aim(v(10,1,10),v(10,2,10));assert.equal(r.placement.get().valid,false);r.unload();assert.equal(r.placement.get().active,false);
});
