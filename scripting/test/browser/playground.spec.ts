import { test, expect, type Page } from "@playwright/test";
import { verifyReferenceImports } from "./reference-validation";

test("invalid imports preserve saved blocks and incoming project references compile", async ({ page }) => {
  await verifyReferenceImports(page);
});

async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prepare Python", exact: true })).toBeEnabled();
}
async function play(page: Page, expected = "running") {
  await page.getByRole("button", { name: "Prepare Python", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 45_000 });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText(expected);
}
async function source(page: Page, code: string) {
  await page.evaluate(async (code) => {
    const api = (window as any).__barkTest;
    await api.load({ ...api.getDocument(), script: { language: "python", source: code } });
  }, code);
}
const position = (page: Page) =>
  page.evaluate(
    () => (window as any).__barkTest.runtime.world.get("player").worldTransform.position,
  );

for (const mode of ["blocks", "python"] as const) {
  test(`${mode}: real Python movement, jump, collection, spawn and Stop restoration`, async ({
    page,
  }) => {
    await open(page);
    if (mode === "python") await page.getByRole("button", { name: "Load Python example" }).click();
    await play(page);
    await expect(page.getByTestId("console")).toContainText("Collect the three gems");
    await page.getByLabel("Game viewport").click();
    const start = await position(page);
    await page.keyboard.down("w");
    await expect.poll(async () => (await position(page)).z).toBeGreaterThan(start.z + 1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__barkTest.runtime.world
              .list()
              .filter((e: any) => e.tags.includes("collectible")).length,
        ),
      )
      .toBeLessThan(3);
    await page.keyboard.up("w");
    await page.keyboard.press("r");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__barkTest.runtime.world.list().some((e: any) => e.name === "Crate"),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Space");
    await expect.poll(async () => (await position(page)).y).toBeGreaterThan(1.4);
    await page.getByRole("button", { name: "■ Stop", exact: true }).click();
    await expect(page.getByTestId("status")).toHaveText("idle");
    expect((await position(page)).z).toBe(-3);
    expect(
      await page.evaluate(
        () =>
          (window as any).__barkTest.runtime.world
            .list()
            .filter((e: any) => e.tags.includes("collectible")).length,
      ),
    ).toBe(3);
    await page.screenshot({ path: `test-results/${mode}-playground.png` });
  });
}
test("pause freezes game waits and resumes them without restarting", async ({ page }) => {
  await open(page);
  await source(
    page,
    'from bark import game\n@game.on_start\nasync def start():\n    print("before")\n    await game.wait(1)\n    print("after")\n',
  );
  await play(page);
  await expect(page.getByTestId("console")).toContainText("before");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("console")).not.toContainText("after");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByTestId("console")).toContainText("after");
});
test("infinite Python loop cannot freeze Stop or the editor", async ({ page }) => {
  await open(page);
  await source(
    page,
    "from bark import game\n@game.on_start\nasync def start():\n    while True:\n        pass\n",
  );
  await page.evaluate(() => (window as any).__barkTest.session.setInspection(true));
  await play(page);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "■ Stop", exact: true }).click({ timeout: 3000 });
  await expect(page.getByTestId("status")).toHaveText("idle");
  await source(
    page,
    'from bark import game\n@game.on_start\nasync def start():\n    print("restarted")\n',
  );
  await play(page);
  await expect(page.getByTestId("console")).toContainText("restarted");
});
test("Python exceptions retain user lines; editor keeps a recoverable block backup", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Convert to Python →" }).click();
  await expect(page.getByRole("button", { name: "Restore saved blocks" })).toBeVisible();
  await page.getByRole("button", { name: "Restore saved blocks" }).click();
  await expect(page.getByRole("button", { name: "Convert to Python →" })).toBeVisible();
  await source(
    page,
    "from bark import game\n@game.on_start\nasync def start():\n    print(1 / 0)\n",
  );
  await play(page, "error");
  await expect(page.getByRole("alert")).toContainText("Line 4");
  await expect(page.getByTestId("status")).toHaveText("error");
});
test("input focus and pause release movement; repeated Play resets Python globals", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Load Python example" }).click();
  await play(page);
  await page.getByLabel("Game viewport").click();
  await page.keyboard.down("w");
  await expect.poll(async () => (await position(page)).z).toBeGreaterThan(-2);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.keyboard.up("w");
  const before = await position(page);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForTimeout(500);
  const after = await position(page);
  expect(Math.abs(after.z - before.z)).toBeLessThan(0.6);
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await source(
    page,
    'from bark import game\ncount = 0\n@game.on_start\nasync def start():\n    global count\n    count += 1\n    print("COUNT", count)\n',
  );
  for (let i = 0; i < 2; i++) {
    await play(page);
    await expect(page.getByTestId("console")).toHaveText("COUNT 1");
    await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  }
});
test("block runtime errors identify the source block and generated line", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const api = (window as any).__barkTest;
    await api.load({
      ...api.getDocument(),
      script: {
        language: "blocks",
        workspace: {
          blocks: {
            languageVersion: 0,
            blocks: [
              {
                type: "bark_start",
                id: "start",
                inputs: {
                  DO: {
                    block: {
                      type: "text_print",
                      id: "bad-print",
                      inputs: {
                        TEXT: {
                          block: {
                            type: "math_arithmetic",
                            fields: { OP: "DIVIDE" },
                            inputs: {
                              A: { block: { type: "math_number", fields: { NUM: 1 } } },
                              B: { block: { type: "math_number", fields: { NUM: 0 } } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    });
    (window as any).__lastDiagnostic = null;
    api.session.onDiagnostic((d: unknown) => {
      (window as any).__lastDiagnostic = d;
    });
  });
  await play(page, "error");
  expect(await page.evaluate(() => (window as any).__lastDiagnostic.blockId)).toBe("bad-print");
  await expect(page.getByRole("alert")).toContainText("division by zero");
});
test("built library loads its own worker and supports the public gameplay API", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(async () => {
    const runtimeUrl = "/dist/index.js",
      adapterUrl = "/dist/engine.js";
    const { createScriptingSession, compilePython } = await import(runtimeUrl);
    const { createEngineAdapter } = await import(adapterUrl);
    const engine = (window as any).__barkTest.runtime;
    const session = createScriptingSession(createEngineAdapter(engine));
    (window as any).__librarySession = session;
    (window as any).__libraryOutput = "";
    session.onOutput(({ text }: { text: string }) => {
      (window as any).__libraryOutput += text;
    });
    session.onDiagnostic((d: unknown) => {
      (window as any).__libraryError = d;
    });
    await session.prepare(
      compilePython({
        language: "python",
        source: `from bark import game
@game.on_start
async def run():
    player = game.entity("player")
    await player.move(1, 0, 0)
    await player.turn(90)
    await player.move_forward(1)
    position = await player.position()
    assert abs(position.x - 2) < 0.1
    assert len(await game.find(tag="collectible")) == 3
    crate = await game.spawn("crate", 4, 3, 0)
    assert abs((await crate.position()).x - 4) < 0.1
    await crate.destroy()
    assert not (await game.input("forward")).held
    assert isinstance(await player.grounded(), bool)
    assert isinstance((await player.velocity()).y, (int, float))
    try:
        await game.entity("missing").position()
    except Exception:
        print("EXPECTED MISSING ENTITY")
    else:
        raise AssertionError("Missing entity did not fail")
    await game.wait(0.05)
    print("API OK")
@game.on_interact("test-sign")
async def interact(actor_id):
    print("ACTOR", actor_id)
`,
      }),
    );
    session.play();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__libraryError ?? (window as any).__libraryOutput)).toEqual(expect.stringContaining("API OK"));
  await page.evaluate(() => {
    const engine = (window as any).__barkTest.runtime;
    const p = engine.world.get("player").worldTransform.position;
    engine.world.spawn({
      id: "test-sign",
      name: "Interaction fixture",
      transform: { position: { x: p.x + 2, y: p.y, z: p.z } },
      visual: { kind: "box", size: { x: 1, y: 1, z: 1 }, color: "#ffffff" },
      collider: {},
      interaction: { enabled: true, distance: 3, prompt: "Read" },
    });
    engine.dispatch({ type: "interact", id: "test-sign", actorId: "player" });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__libraryOutput))
    .toContain("ACTOR player");
  expect(await page.evaluate(() => (window as any).__libraryError)).toBeUndefined();
  await page.evaluate(() => (window as any).__librarySession.dispose());
});
