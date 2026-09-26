import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import { NullEngine } from "../../engine/node_modules/@babylonjs/core/Engines/nullEngine.js";
import { Runtime } from "../../engine/src/runtime";
import { createProject, defineEntity } from "@bark/engine";
import { createPlayerController } from "../src/player-controller";
import { createEngineAdapter } from "../src/engine";
import { createScriptingSession } from "../src/session";
import { serializeGame, parseGame } from "../src/game-file";
import { FakeWorker } from "./fakes";

const havok = await HavokPhysics({ wasmBinary: new Uint8Array(await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url))).buffer });
function game(name = "Original") {
  const project = createProject(name); project.properties = { score: 0 };
  project.entities = [defineEntity({ id: "ball", visual: { kind: "sphere", size: { x: 1, y: 1, z: 1 } }, collider: { shape: "sphere" }, body: {}, transform: { position: { x: 0, y: 4, z: 0 } } })];
  return { version: 1 as const, project, script: { language: "python" as const, source: "print('module setup')" } };
}
async function fixture(t: TestContext) {
  const runtime = new Runtime(new NullEngine(), havok), workers: FakeWorker[] = [];
  const session = createScriptingSession(createEngineAdapter(runtime), { workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  const player = createPlayerController(runtime, session);
  t.after(() => player.dispose());
  await player.load(JSON.stringify(game()));
  async function play() {
    const starting = player.play(); await new Promise((r) => setImmediate(r));
    workers.at(-1)!.send({ type: "ready" }); await starting;
  }
  return { runtime, session, player, workers, play };
}
test("load never creates a worker; Play, pause and Stop preserve exact authored state", async (t) => {
  const { runtime, player, workers, play } = await fixture(t);
  const authored = runtime.exportProject(); assert.equal(workers.length, 0); assert.equal(player.status, "ready");
  await play(); assert.equal(player.status, "running");
  runtime.properties.set(null, "score", 42); runtime.world.destroy("ball"); runtime.feedback.notify("Hello", 5);
  runtime.advance(1 / 60); const tick = runtime.clock.tick; player.pause(); runtime.advance(1); assert.equal(runtime.clock.tick, tick);
  player.resume(); runtime.advance(1 / 60); assert.equal(runtime.clock.tick, tick + 1);
  const saved = await parseGame(await serializeGame({ ...game(), project: runtime.exportProject() }));
  assert.deepEqual(saved.project, authored);
  player.stop(); assert.equal(workers[0].terminated, true); assert.equal(player.status, "ready");
  assert.deepEqual(runtime.exportProject(), authored); assert.equal(runtime.world.get("ball").transform.position.y, 4);
  assert.equal(runtime.properties.get(null, "score"), 0); assert.equal(runtime.clock.tick, 0); assert.equal(player.getFeedback().notifications.length, 0);
  const restarting = player.restart(); await new Promise((r) => setImmediate(r)); workers[1].send({ type: "ready" }); await restarting;
  assert.equal(workers.length, 2); assert.equal(player.status, "running");
});
test("invalid imports preserve running game; failed external asset loads restore the previous authored world", async (t) => {
  const { runtime, player, play } = await fixture(t); await play(); runtime.properties.set(null, "score", 12);
  await assert.rejects(player.load("invalid")); assert.equal(player.status, "running"); assert.equal(runtime.properties.get(null, "score"), 12);
  const next = game("Broken"); next.project.assets = [{ id: "model", type: "model", url: "https://assets.example/broken.glb" }];
  t.mock.method(globalThis, "fetch", async () => new Response("missing", { status: 404 }));
  await assert.rejects(player.load(JSON.stringify(next)), /404/);
  assert.equal(player.getSnapshot().name, "Original"); assert.equal(player.status, "ready"); assert.equal(runtime.state, "editing"); assert.equal(runtime.properties.get(null, "score"), 0);
});
test("Stop, replacement and disposal settle pending preparation and suppress late workers", async (t) => {
  for (const action of ["stop", "replace", "dispose"] as const) {
    const { player, workers } = await fixture(t);
    const starting = player.play(); const rejected = assert.rejects(starting);
    await new Promise((r) => setImmediate(r));
    if (action === "replace") await player.load(JSON.stringify(game("Replacement")));
    else player[action]();
    await rejected; assert.equal(workers[0].terminated, true); workers[0].send({ type: "ready" });
    assert.equal(player.status, action === "dispose" ? "disposed" : "ready");
    if (action === "replace") assert.equal(player.getSnapshot().name, "Replacement");
  }
});
test("latest load wins; abort and dispose during asset loading settle without stale restoration", async (t) => {
  const { player } = await fixture(t);
  let started!: () => void;
  let waiting = new Promise<void>((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }); started();
  }));
  const slow = game("Slow"); slow.project.assets = [{ id: "slow", type: "model", url: "https://assets.example/slow.glb" }];
  const pending = player.load(JSON.stringify(slow)), rejected = assert.rejects(pending); await waiting;
  await player.load(JSON.stringify(game("Newest"))); await rejected;
  assert.equal(player.getSnapshot().name, "Newest"); assert.equal(player.status, "ready");
  waiting = new Promise<void>((resolve) => { started = resolve; });
  const abort = new AbortController(); const cancelled = player.load(JSON.stringify(slow), { signal: abort.signal });
  const cancelCheck = assert.rejects(cancelled); await waiting; abort.abort(); await cancelCheck;
  assert.equal(player.status, "ready"); assert.equal(player.getSnapshot().name, "Newest");
  waiting = new Promise<void>((resolve) => { started = resolve; });
  const disposing = player.load(JSON.stringify(slow)), disposedCheck = assert.rejects(disposing); await waiting; player.dispose(); await disposedCheck;
  assert.equal(player.status, "disposed");
});
test("status/feedback observers get detached data and can Stop or dispose during callbacks", async (t) => {
  const { player, workers, play, runtime } = await fixture(t);
  const off = player.onStatus((snapshot) => { snapshot.name = "mutated"; if (snapshot.status === "preparing") player.stop(); });
  await assert.rejects(player.play(), /stopped/); assert.equal(workers.length, 0); assert.equal(player.status, "ready"); off();
  await play();
  player.onFeedback((feedback) => { feedback.notifications.length = 0; });
  runtime.feedback.notify("Kept", 5); assert.equal(player.getFeedback().notifications.length, 1);
  player.onStatus((s) => { if (s.status === "ready") player.dispose(); });
  player.stop(); assert.equal(player.status, "disposed"); player.dispose();
});

test("preparation errors preserve structured diagnostics and allow recovery", async (t) => {
  const { player, workers, runtime, play } = await fixture(t);
  const diagnostics: unknown[] = []; player.onDiagnostic((d) => diagnostics.push(d));
  const starting = player.play(), rejected = assert.rejects(starting, /bad syntax/);
  await new Promise((r) => setImmediate(r));
  workers[0].send({ type: "error", diagnostic: { message: "bad syntax", line: 3 } });
  await rejected;
  assert.equal(player.status, "error"); assert.equal(runtime.state, "editing");
  assert.equal(diagnostics.length, 1); assert.equal((diagnostics[0] as { line: number }).line, 3);
  player.stop(); await play(); assert.equal(player.status, "running");
});
