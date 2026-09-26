import test from "node:test";
import assert from "node:assert/strict";
import { createScriptingSession, SESSION_LIMITS } from "../src/session";
import { FakeAdapter, FakeWorker } from "./fakes";

async function setup() {
  const adapter = new FakeAdapter(),
    workers: FakeWorker[] = [];
  const session = createScriptingSession(adapter, {
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  const ready = session.prepare({
    python: "",
    diagnostics: [],
    sourceMap: { 3: "bad-block" },
  });
  workers[0].send({ type: "ready" });
  await ready;
  return { adapter, session, worker: workers[0], workers };
}
test("commands execute before a tick, preserve request order, and return engine failures", async () => {
  const { adapter, session, worker } = await setup();
  session.play();
  worker.send({
    type: "request",
    request: 1,
    operation: { op: "position", id: "player" },
  });
  worker.send({
    type: "request",
    request: 2,
    operation: { op: "position", id: "missing" },
  });
  assert.equal(adapter.operations.length, 0);
  adapter.step();
  assert.deepEqual(
    adapter.operations.map((o) => ("id" in o ? o.id : "")),
    ["player", "missing"],
  );
  const responses = worker.messages.filter((m) => m.type === "response");
  assert.equal(responses[0].request, 1);
  assert.match(responses[1].error!, /not found/);
  assert.equal(worker.messages.at(-1)?.type, "tick");
  session.dispose();
});
test("pause gates commands and resume applies pending work; tick notifications coalesce", async () => {
  const { adapter, session, worker } = await setup();
  session.play();
  session.pause();
  worker.send({
    type: "request",
    request: 1,
    operation: { op: "destroy", id: "player" },
  });
  adapter.step();
  assert.equal(adapter.operations.length, 0);
  session.resume();
  adapter.step();
  adapter.step();
  adapter.step();
  assert.equal(adapter.operations.length, 1);
  assert.equal(worker.messages.filter((m) => m.type === "tick").length, 1);
  worker.send({ type: "tick_ack" });
  const ticks = worker.messages.filter((m) => m.type === "tick");
  assert.equal(ticks.length, 2);
  assert.equal(ticks[1].clock.tick, 3);
  session.dispose();
});
test("Stop invalidates late replies and restart does not duplicate subscriptions", async () => {
  const { adapter, session, worker, workers } = await setup();
  session.play();
  session.stop();
  assert.equal(worker.terminated, true);
  assert.equal(adapter.updates.size, 0);
  const ready = session.prepare({ python: "", sourceMap: {}, diagnostics: [] });
  workers[1].send({ type: "ready" });
  await ready;
  session.play();
  worker.send({
    type: "request",
    request: 5,
    operation: { op: "destroy", id: "player" },
  });
  adapter.step();
  assert.equal(adapter.operations.length, 0);
  assert.equal(adapter.updates.size, 1);
  assert.equal(adapter.events.size, 1);
  session.dispose();
  assert.equal(adapter.states.size, 0);
});
test("errors map to blocks, halt worker, and pause the world", async () => {
  const { adapter, session, worker } = await setup();
  session.play();
  let block: string | undefined;
  session.onDiagnostic((d) => {
    block = d.blockId;
  });
  worker.send({ type: "error", diagnostic: { message: "broken", line: 3 } });
  assert.equal(block, "bad-block");
  assert.equal(session.status, "error");
  assert.equal(adapter.state, "paused");
  assert.ok(worker.terminated);
  session.dispose();
});
test("bounded command and event queues fail explicitly", async () => {
  for (const kind of ["commands", "events"] as const) {
    const { adapter, session, worker } = await setup();
    session.play();
    for (let i = 0; i <= SESSION_LIMITS[kind]; i++) {
      if (kind === "commands")
        worker.send({
          type: "request",
          request: i,
          operation: { op: "position", id: "player" },
        });
      else
        adapter.events.forEach((fn) =>
          fn({ type: "touch", entityId: "player", otherId: "gem" }),
        );
    }
    assert.equal(session.status, "error");
    session.dispose();
  }
});
test("external load cancels preparation and removes callbacks", async () => {
  const adapter = new FakeAdapter(),
    worker = new FakeWorker();
  const session = createScriptingSession(adapter, {
    workerFactory: () => worker,
  });
  const ready = session.prepare({ python: "", sourceMap: {}, diagnostics: [] });
  const rejected = assert.rejects(ready, /world changed/);
  adapter.transition("loading");
  await rejected;
  assert.equal(session.status, "idle");
  assert.ok(worker.terminated);
  session.dispose();
});
test("coalesced clocks cannot move backwards after paused acknowledgements", async () => {
  const { adapter, session, worker } = await setup();
  session.play();
  adapter.step();
  adapter.step();
  session.pause();
  worker.send({ type: "tick_ack" });
  session.resume();
  adapter.step();
  worker.send({ type: "tick_ack" });
  const ticks = worker.messages
    .filter((m) => m.type === "tick")
    .map((m) => m.clock.tick);
  assert.deepEqual(ticks, [1, 3]);
  session.dispose();
});
test("a synchronous engine Stop or Pause interrupts the current command batch", async () => {
  for (const nextState of ["editing", "paused"] as const) {
    const { adapter, session, worker } = await setup();
    session.play();
    const execute = adapter.execute.bind(adapter);
    adapter.execute = (operation) => {
      const result = execute(operation);
      if (adapter.operations.length === 1) adapter.transition(nextState);
      return result;
    };
    for (let request = 1; request <= 2; request++) {
      worker.send({
        type: "request",
        request,
        operation: { op: "position", id: "player" },
      });
    }
    adapter.step();
    assert.equal(adapter.operations.length, 1);
    if (nextState === "paused") {
      session.resume();
      adapter.step();
      assert.equal(adapter.operations.length, 2);
    } else {
      assert.equal(session.status, "idle");
    }
    session.dispose();
  }
});

test("async engine actions do not block later requests and late completions cannot cross sessions", async () => {
  const { adapter, session, worker, workers } = await setup();
  let finish!: (value: unknown) => void;
  (adapter as import("../src/types").EngineAdapter).execute = (operation) =>
    operation.op === "glide_to"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : 42;
  session.play();
  worker.send({
    type: "request",
    request: 1,
    operation: {
      op: "glide_to",
      id: "door",
      vector: { x: 1, y: 0, z: 0 },
      seconds: 1,
      easing: "linear",
    },
  });
  worker.send({
    type: "request",
    request: 2,
    operation: { op: "position", id: "player" },
  });
  adapter.step();
  assert.deepEqual(
    worker.messages.filter((m) => m.type === "response").map((m) => m.request),
    [2],
  );
  session.stop();
  const ready = session.prepare({ python: "", sourceMap: {}, diagnostics: [] });
  workers[1].send({ type: "ready" });
  await ready;
  session.play();
  finish({ status: "completed" });
  await Promise.resolve();
  assert.equal(
    workers[1].messages.filter((m) => m.type === "response").length,
    0,
  );
  session.dispose();
});

test("unfinished asynchronous commands count toward the command limit", async () => {
  const { adapter, session, worker } = await setup();
  (adapter as import("../src/types").EngineAdapter).execute = () =>
    new Promise(() => {});
  session.play();
  for (let request = 0; request < SESSION_LIMITS.commands; request++) {
    worker.send({
      type: "request",
      request,
      operation: { op: "position", id: "player" },
    });
    adapter.step();
  }
  assert.equal(session.status, "running");
  worker.send({
    type: "request",
    request: 257,
    operation: { op: "position", id: "player" },
  });
  assert.equal(session.status, "error");
  session.dispose();
});

test("inspection is opt-in and maps source locations without confusing diagnostics", async () => {
  const { session, worker } = await setup();
  const snapshots: import("../src/types").Inspection[] = [];
  session.onInspection((s) => snapshots.push(s));
  const snapshot = { line: 3, globals: { score: 2 }, locals: {}, activity: [] };
  worker.send({ type: "inspection", snapshot });
  assert.equal(snapshots.length, 0);
  session.setInspection(true);
  worker.send({ type: "inspection", snapshot });
  assert.equal(snapshots[0].blockId, "bad-block");
  assert.equal(session.status, "ready");
  session.dispose();
});
