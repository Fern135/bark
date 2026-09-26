import { test, expect, type Page } from "@playwright/test";
import { compileBlocks } from "../../src/blocks";

async function open(page: Page, code?: string) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Prepare Python", exact: true }),
  ).toBeEnabled();
  if (code)
    await page.evaluate(async (code) => {
      const api = (window as any).__barkTest;
      await api.load({
        ...api.getDocument(),
        script: { language: "python", source: code },
      });
    }, code);
}
async function play(page: Page) {
  await page
    .getByRole("button", { name: "Prepare Python", exact: true })
    .click();
  await expect(page.getByTestId("status")).toHaveText("ready", {
    timeout: 45000,
  });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("running");
}
for (const mode of ["blocks", "python"])
  test(`${mode}: full coin gate, timer, function return, broadcasts, checkpoint and restoration`, async ({
    page,
  }) => {
    await open(page);
    if (mode === "python")
      await page.getByRole("button", { name: "Load Python example" }).click();
    await page.getByText("Live inspection", { exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Enable live inspection" })
      .check();
    await play(page);
    await expect(page.getByTestId("hud-score")).toContainText("Score: 0");
    await page.getByLabel("Game viewport").click();
    await page.keyboard.down("w");
    await expect(page.getByTestId("hud-score")).toContainText("Score: 6");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__barkTest.runtime.characters.get("player").spawn
              .position.z,
        ),
      )
      .toBe(5);
    await page.keyboard.up("w");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__barkTest.runtime.interactions.target("player"),
        ),
      )
      .toBe("door");
    await page.keyboard.press("e");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__barkTest.runtime.world.get("door").transform
              .position.x,
        ),
      )
      .toBeCloseTo(6, 1);
    await expect(page.locator(".notifications")).toContainText("Gate open!");
    await expect(page.getByTestId("inspection")).toContainText("door_opened");
    await expect(page.getByTestId("hud-seconds")).not.toContainText("Time: 60");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const countdown = await page.getByTestId("hud-seconds").textContent();
    await page.waitForTimeout(1100);
    await expect(page.getByTestId("hud-seconds")).toHaveText(countdown!);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.getByTestId("hud-seconds")).not.toHaveText(countdown!);
    await page.getByLabel("Game viewport").click();
    await page.evaluate(() =>
      (window as any).__barkTest.runtime.characters.teleport("player", {
        position: { x: 0, y: -12, z: 2 },
      }),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__barkTest.runtime.world.get("player")
              .worldTransform.position.z,
        ),
      )
      .toBeCloseTo(5, 1);
    await page.keyboard.down("w");
    await expect(page.getByTestId("console")).toContainText("Goal reached!");
    await page.keyboard.up("w");
    await page.screenshot({ path: `test-results/coin-gate-${mode}.png` });
    await page.getByRole("button", { name: "■ Stop", exact: true }).click();
    const authored = await page.evaluate(() => {
      const r = (window as any).__barkTest.runtime;
      return {
        score: r.properties.get(null, "score"),
        door: r.world.get("door").transform.position.x,
        locked: r.properties.get("door", "locked"),
        hud: r.feedback.get().hud,
      };
    });
    expect(authored).toEqual({ score: 0, door: 0, locked: true, hud: {} });
  });

test("properties inspector exports authored values while runtime changes remain temporary", async ({
  page,
}) => {
  await open(page);
  await page.locator("summary").filter({ hasText: "Properties ·" }).click();
  await page.getByLabel("Property name", { exact: true }).fill("score");
  await page.getByLabel("Property JSON value").fill("12");
  await page
    .getByRole("button", { name: "Save property", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as any).__barkTest.getDocument().project.properties.score,
    ),
  ).toBe(12);
  await play(page);
  await expect(page.getByTestId("hud-score")).toContainText("12");
  await expect(
    page.getByRole("button", { name: "Save property", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as any).__barkTest.runtime.properties.set(null, "score", 99),
  );
  expect(
    await page.evaluate(
      () => (window as any).__barkTest.getDocument().project.properties.score,
    ),
  ).toBe(12);
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).__barkTest.runtime.properties.get(null, "score"),
    ),
  ).toBe(12);
});

test("real Python property semantics, atomic changes, ordered broadcasts, timer cancellation and inspection bounds", async ({
  page,
}) => {
  await open(
    page,
    `from bark import game
import asyncio
class Unsafe:
    def __repr__(self):
        raise RuntimeError("repr must not execute")
unsafe = Unsafe()
cyclic = []
cyclic.append(cyclic)
seen = []
@game.on_message("work")
async def work(payload):
    seen.append(payload["n"])
    await game.properties.change("count", 1)
@game.on_timer("cancelled")
async def forbidden():
    raise RuntimeError("cancelled timer fired")
@game.on_timer("pulse")
async def pulse():
    await game.properties.change("pulses", 1)
    await game.wait(0.04)
@game.on_start
async def start():
    p = game.properties
    await p.set("nullable", None)
    assert await p.has("nullable")
    assert await p.get("nullable", 9) is None
    assert await p.get("absent", 9) == 9
    assert not await p.has("absent")
    assert await p.remove("nullable")
    assert not await p.remove("nullable")
    await p.set("count", 0)
    await p.set("pulses", 0)
    await game.start_timer("cancelled", 0.2)
    await game.cancel_timer("cancelled")
    await game.start_timer("pulse", 0.01, repeat=True)
    for i in range(110):
        payload = {"n": i}
        await game.broadcast("work", payload)
        payload["n"] = -1
    while await p.get("count") < 110:
        await game.next_frame()
    assert seen == list(range(110))
    await game.cancel_timer("pulse")
    saved = await p.get("pulses")
    await game.wait(0.2)
    assert await p.get("pulses") == saved
    assert "count" in await p.list()
    print("SEMANTICS_OK")
    while True:
        await game.next_frame()
`,
  );
  await page.evaluate(() => {
    const s = (window as any).__barkTest.session;
    (window as any).snapshots = [];
    s.onInspection((snapshot: any) =>
      (window as any).snapshots.push({ snapshot, time: performance.now() }),
    );
    s.setInspection(true);
  });
  await play(page);
  await expect(page.getByTestId("console")).toContainText("SEMANTICS_OK");
  const snapshots = await page.evaluate(() => (window as any).snapshots);
  expect(snapshots.at(-1).snapshot.activity).toHaveLength(200);
  expect(snapshots.at(-1).snapshot.globals.unsafe).toBe("<unsupported value>");
  expect(JSON.stringify(snapshots.at(-1).snapshot.globals.cyclic)).toContain(
    "depth limit",
  );
  // Main-thread scheduling can deliver several worker messages together; measure the rate over the window.
  expect(snapshots.length).toBeLessThanOrEqual(
    Math.ceil((snapshots.at(-1).time - snapshots[0].time) / 100) + 3,
  );
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
});

test("awaited motion can be replaced, pauses with the world, and Stop invalidates pending completion", async ({
  page,
}) => {
  await open(
    page,
    `from bark import game
@game.on_start
async def first():
    result = await game.entity("door").glide_to(5, 1.5, 7, 3)
    print("FIRST", result["status"])
@game.on_start
async def replacement():
    await game.wait(0.2)
    result = await game.entity("door").glide_to(6, 1.5, 7, 2)
    print("SECOND", result["status"])
`,
  );
  await play(page);
  await expect(page.getByTestId("console")).toContainText("FIRST cancelled");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const x = await page.evaluate(
    () =>
      (window as any).__barkTest.runtime.world.get("door").transform.position.x,
  );
  await page.waitForTimeout(350);
  expect(
    await page.evaluate(
      () =>
        (window as any).__barkTest.runtime.world.get("door").transform.position
          .x,
    ),
  ).toBe(x);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByTestId("console")).toContainText("SECOND completed");
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await play(page);
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () =>
        (window as any).__barkTest.runtime.world.get("door").transform.position
          .x,
    ),
  ).toBe(0);
  await expect(page.getByTestId("console")).not.toContainText(
    "SECOND completed",
  );
});

test("generated parameterized functions, nested loops, lists, strings and randomness run in real Python", async ({
  page,
}) => {
  type B = {
    type: string;
    fields?: Record<string, unknown>;
    inputs?: Record<string, { block: B }>;
    extraState?: unknown;
    next?: { block: B };
  };
  const block = (
    type: string,
    inputs: Record<string, B> = {},
    fields?: Record<string, unknown>,
  ): B => ({
    type,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([k, block]) => [k, { block }]),
    ),
    fields,
  });
  const num = (n: number) => block("math_number", {}, { NUM: n });
  const text = (s: string) => block("text", {}, { TEXT: s });
  const get = (id: string) => block("variables_get", {}, { VAR: { id } });
  const chain = (...blocks: B[]) => {
    for (let i = 0; i < blocks.length - 1; i++)
      blocks[i].next = { block: blocks[i + 1] };
    return blocks[0];
  };
  const list = (...values: B[]): B => ({
    ...block(
      "lists_create_with",
      Object.fromEntries(values.map((v, i) => [`ADD${i}`, v])),
    ),
    extraState: { itemCount: values.length },
  });
  const definition: B = {
    ...block(
      "procedures_defreturn",
      {
        STACK: chain(
          block("bark_list_append", { LIST: get("items"), VALUE: num(7) }),
          block("bark_list_set", {
            LIST: get("items"),
            INDEX: num(0),
            VALUE: num(3),
          }),
          block("bark_list_remove", { LIST: get("items"), INDEX: num(1) }),
          block("variables_set", { VALUE: num(0) }, { VAR: { id: "total" } }),
          block(
            "controls_forEach",
            {
              LIST: get("items"),
              DO: block("controls_repeat_ext", {
                TIMES: num(1),
                DO: block(
                  "math_change",
                  { DELTA: get("item") },
                  { VAR: { id: "total" } },
                ),
              }),
            },
            { VAR: { id: "item" } },
          ),
        ),
        RETURN: {
          ...block("text_join", {
            ADD0: get("total"),
            ADD1: block("bark_slice", {
              TEXT: text("abcdef"),
              START: num(1),
              END: num(4),
            }),
            ADD2: block("lists_length", { VALUE: get("items") }),
          }),
          extraState: { itemCount: 3 },
        },
      },
      { NAME: "collect" },
    ),
    extraState: { params: [{ name: "items", id: "items" }] },
  };
  const call: B = {
    ...block("procedures_callreturn", { ARG0: list(num(1), num(2)) }),
    extraState: { name: "collect", params: ["items"] },
  };
  const workspace = {
    variables: ["items", "item", "total"].map((id) => ({ id, name: id })),
    blocks: {
      languageVersion: 0,
      blocks: [
        definition,
        block("bark_start", {
          DO: chain(
            block("text_print", { TEXT: call }),
            block("text_print", { TEXT: get("items") }),
            block("text_print", {
              TEXT: block("math_random_int", { FROM: num(7), TO: num(7) }),
            }),
            block("text_print", {
              TEXT: block(
                "logic_compare",
                { A: block("math_random_float"), B: num(1) },
                { OP: "LT" },
              ),
            }),
          ),
        }),
      ],
    },
  };
  const compiled = compileBlocks({ language: "blocks", workspace });
  expect(compiled.diagnostics).toEqual([]);
  await open(page, compiled.python);
  await play(page);
  await expect(page.getByTestId("console")).toContainText("10bcd2\n0\n7\nTrue");
  await expect(page.getByTestId("status")).toHaveText("running");
});

test("inspection can be toggled while Pyodide is still preparing", async ({
  page,
}) => {
  await open(
    page,
    "from bark import game\nscore = 7\n@game.on_start\nasync def start():\n    while True:\n        await game.next_frame()\n",
  );
  await page.route("**/pyodide/pyodide.mjs", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.getByText("Live inspection", { exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare Python", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Enable live inspection" }).check();
  await expect(page.getByTestId("status")).toHaveText("ready", {
    timeout: 45000,
  });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect(page.getByTestId("inspection")).toContainText('"score": 7');
  await expect(page.getByTestId("status")).toHaveText("running");
});
