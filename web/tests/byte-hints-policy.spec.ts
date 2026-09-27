import { expect, test } from "@playwright/test";
import { mock } from "node:test";
import { ByteHints, ByteReviewError, type ByteRequest, type ByteResponse, type ByteSnapshot, type ByteSuggestion } from "../src/lib/byte-hints";

test.setTimeout(1_000_000); // This suite deliberately advances mocked wall time.

const snapshot: ByteSnapshot = { language: "python", python: "game.wait(1)", sourceMap: {}, blocks: [], context: {}, diagnostics: [] };
const hint: ByteSuggestion = { category: "bug", message: "Add await so this call pauses the handler.", issueKey: "missing-await", line: 1, blockId: null };
let controller: ByteHints;
let calls: ByteRequest[];
let respond: (body: ByteRequest) => Promise<ByteResponse>;
const input = (key = "initial", localRevision = 0, extra = {}) => ({ identity: "user:project", key, localRevision, enabled: true, active: true, snapshot: () => snapshot, ...extra });
async function tick(ms: number) { mock.timers.tick(ms); await Promise.resolve(); await Promise.resolve(); }

test.beforeEach(() => {
  mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  calls = [];
  respond = async (body) => ({ revision: body.revision, suggestion: hint });
  controller = new ByteHints(async (body) => { calls.push(body); return respond(body); });
  controller.update(input());
});
test.afterEach(() => { controller.dispose(); mock.timers.reset(); });

test("initial load, selections, layout-only moves, and remote-only changes stay quiet", async () => {
  await tick(60_000);
  controller.update(input("initial", 1));
  await tick(60_000);
  controller.update(input("remote", 1));
  await tick(60_000);
  expect(calls).toHaveLength(0);
});

test("debounces local edits and applies both request and display cooldowns", async () => {
  controller.update(input("edit", 1));
  await tick(4999); expect(calls).toHaveLength(0);
  controller.update(input("next edit", 2));
  await tick(4999); expect(calls).toHaveLength(0);
  await tick(1); expect(calls).toHaveLength(1);
  expect(controller.getSnapshot()).toEqual(hint);
  controller.update(input("more", 3));
  expect(controller.getSnapshot()).toBeNull();
  await tick(44_999); expect(calls).toHaveLength(1);
  await tick(1); expect(calls).toHaveLength(2);
  expect(controller.getSnapshot()).toBeNull();
  expect(calls[1].dismissed[0].issueKey).toBe("missing-await");
});

test("editing, project switch, logout and disabling discard late results", async () => {
  for (const extra of [{ key: "changed", localRevision: 2 }, { identity: "user:other" }, { identity: "guest:project", enabled: false }, { enabled: false }, { active: false }]) {
    controller.dispose();
    let finish!: (response: ByteResponse) => void;
    let body!: ByteRequest;
    controller = new ByteHints((request) => { body = request; return new Promise((resolve) => { finish = resolve; }); });
    controller.update(input()); controller.update(input("edit", 1));
    await tick(5000);
    controller.update(input("edit", 1, extra));
    finish({ revision: body.revision, suggestion: hint });
    await tick(0);
    expect(controller.getSnapshot()).toBeNull();
  }
});

test("dragging, composition, hidden tabs and modals suspend reviews", async () => {
  controller.update(input("edit", 1));
  controller.activity(true);
  await tick(60_000); expect(calls).toHaveLength(0);
  controller.activity(false);
  await tick(4999); expect(calls).toHaveLength(0);
  await tick(1); expect(calls).toHaveLength(1);
  controller.activity(true);
  expect(controller.getSnapshot()).toEqual(hint); // Pointer-down must not eat the dismiss click.
  controller.dismiss(); expect(controller.getSnapshot()).toBeNull();
});

test("gameplay suspends pending review until the code editor is active", async () => {
  controller.update(input("edit", 1));
  controller.update(input("edit", 1, { active: false }));
  await tick(60_000); expect(calls).toHaveLength(0);
  controller.update(input("edit", 1));
  await tick(0); expect(calls).toHaveLength(1);
});

test("failures back off, do not poll unchanged code, and honor longer Retry-After", async () => {
  respond = async () => { throw new ByteReviewError(180_000); };
  controller.update(input("edit", 1)); await tick(5000);
  await tick(60_000); expect(calls).toHaveLength(1);
  controller.update(input("edit again", 2));
  await tick(119_999); expect(calls).toHaveLength(1);
  await tick(1); expect(calls).toHaveLength(2);
});

test("oversized snapshots and invalid response locations never display", async () => {
  controller.update(input("large", 1, { snapshot: () => ({ ...snapshot, python: "x".repeat(65536) }) }));
  await tick(5000); expect(calls).toHaveLength(0);
  respond = async (body) => ({ revision: body.revision, suggestion: { ...hint, line: 100 } });
  controller.update(input("small", 2)); await tick(5000);
  expect(calls).toHaveLength(1); expect(controller.getSnapshot()).toBeNull();
});

test("null responses stay silent and dismissed advice stays suppressed when reworded", async () => {
  respond = async (body) => ({ revision: body.revision, suggestion: null });
  controller.update(input("edit", 1)); await tick(5000);
  expect(controller.getSnapshot()).toBeNull();
  respond = async (body) => ({ revision: body.revision, suggestion: hint });
  controller.update(input("edit 2", 2)); await tick(45_000);
  expect(controller.getSnapshot()).toEqual(hint); controller.dismiss();
  respond = async (body) => ({ revision: body.revision, suggestion: { ...hint, issueKey: "unawaited-wait", message: "This wait needs await." } });
  controller.update(input("edit 3", 3)); await tick(45_000);
  expect(controller.getSnapshot()).toBeNull();
});
