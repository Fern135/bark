import { test, expect, type Page } from "@playwright/test";

async function load(page: Page, scripts: Record<string, string>, global = "") {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prepare Python", exact: true })).toBeEnabled();
  await page.evaluate(async ({ scripts, global }) => {
    const api = (window as any).__barkTest;
    (window as any).__objectDiagnostics = [];
    api.session.onDiagnostic((diagnostic: unknown) => (window as any).__objectDiagnostics.push(diagnostic));
    await api.load({ ...api.getDocument(), version: 2, script: { language: "python", source: global }, objectScripts: Object.fromEntries(Object.entries(scripts).map(([id, source]) => [id, { language: "python", source }])) });
  }, { scripts, global });
  await page.getByRole("button", { name: "Prepare Python", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 45000 });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
}

test("object namespaces, shared messages/properties and same-named timers run together", async ({ page }) => {
  const code = (value: number) => `from bark import game
value = ${value}
@game.on_start
async def start():
    await this.properties.set("own", value)
    await game.start_timer("same", 0.1)
@game.on_timer("same")
async def timer():
    await this.properties.set("timer", value)
@game.on_message("shared")
async def message(payload):
    await this.properties.set("message", payload + value)
`;
  await load(page, { player: code(2), door: code(7) }, `from bark import game
value = 100
@game.on_start
async def start():
    await game.properties.set("global", value)
    await game.broadcast("shared", 10)
`);
  await expect.poll(() => page.evaluate(() => {
    const r = (window as any).__barkTest.runtime;
    return [r.properties.get(null, "global"), ...["player", "door"].flatMap((id) => ["own", "timer", "message"].map((key) => r.properties.get(id, key)))];
  })).toEqual([100, 2, 2, 12, 7, 7, 17]);
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__barkTest.runtime.properties.get("player", "own"))).toBeUndefined();
});

test("destroying an owner cancels handlers and waits without stopping other scripts", async ({ page }) => {
  await load(page, { door: `from bark import game
import asyncio
async def background():
    await game.wait(0.5)
    await game.properties.set("background_should_not_run", True)
@game.on_start
async def start():
    asyncio.create_task(background())
    await game.wait(0.5)
    await game.properties.set("should_not_run", True)
` }, `from bark import game
@game.on_start
async def start():
    await game.wait(0.1)
    await game.entity("door").destroy()
    await game.wait(0.7)
    await game.properties.set("survivor", True)
`);
  await expect.poll(() => page.evaluate(() => (window as any).__barkTest.runtime.properties.get(null, "survivor"))).toBe(true);
  expect(await page.evaluate(() => (window as any).__barkTest.runtime.properties.get(null, "should_not_run"))).toBeUndefined();
  expect(await page.evaluate(() => (window as any).__barkTest.runtime.properties.get(null, "background_should_not_run"))).toBeUndefined();
  await expect(page.getByTestId("status")).toHaveText("running");
});

test("object failures preserve their owner and source line", async ({ page }) => {
  await load(page, { player: "from bark import game\n@game.on_start\nasync def start():\n    raise ValueError('object failure')\n" });
  await expect(page.getByTestId("status")).toHaveText("error");
  await expect(page.getByRole("alert")).toContainText("object failure");
  expect(await page.evaluate(() => (window as any).__objectDiagnostics.at(-1))).toMatchObject({ scriptId: "player", line: 4 });
});


test("Blocks variables and My Blocks with identical IDs remain local to each owner", async ({ page }) => {
  const workspace = (value: number) => {
    const number = { type: "math_number", fields: { NUM: value } };
    const variable = { type: "variables_get", fields: { VAR: { id: "same-variable" } } };
    return { variables: [{ name: "value", id: "same-variable" }], blocks: { languageVersion: 0, blocks: [
      { type: "procedures_defreturn", id: "same-function", fields: { NAME: "read_value" }, extraState: { params: [] }, inputs: { RETURN: { block: variable } } },
      { type: "bark_start", id: "same-start", inputs: { DO: { block: { type: "variables_set", fields: { VAR: { id: "same-variable" } }, inputs: { VALUE: { block: number } }, next: { block: {
        type: "bark_property_set", id: "same-effect", inputs: {
          PROPERTIES: { block: { type: "bark_entity_properties", inputs: { ENTITY: { block: { type: "bark_this" } } } } },
          KEY: { block: { type: "text", fields: { TEXT: "block_value" } } },
          VALUE: { block: { type: "procedures_callreturn", extraState: { name: "read_value", params: [] } } },
        },
      } } } } } },
    ] } };
  };
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prepare Python", exact: true })).toBeEnabled();
  await page.evaluate(async (objectScripts) => {
    const api = (window as any).__barkTest;
    await api.load({ ...api.getDocument(), version: 2, script: { language: "blocks", workspace: {} }, objectScripts });
  }, { player: { language: "blocks", workspace: workspace(3) }, door: { language: "blocks", workspace: workspace(9) } });
  await page.getByRole("button", { name: "Prepare Python", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 45_000 });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect.poll(() => page.evaluate(() => ["player", "door"].map((id) => (window as any).__barkTest.runtime.properties.get(id, "block_value")))).toEqual([3, 9]);
});
