import { test, expect } from "@playwright/test";
import { blockFixture, exposedTypes, dropdownModes } from "../block-fixtures";

test("every exposed block executes generated Python against the engine", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prepare Python", exact: true })).toBeEnabled();
  const markers: string[] = [];
  const sources = exposedTypes.filter((type) => type !== "bark_forever").flatMap((type) => [undefined, ...dropdownModes(type)].map((mode) => {
    const result = blockFixture(type, mode).compilation;
    expect(result.diagnostics, type).toEqual([]);
    const marker = `PASS:${type}${mode ? ":" + mode.join("=") : ":default"}`;
    markers.push(marker);
    return result.python.replaceAll(`PASS:${type}`, marker);
  }));
  const source = `from bark import game\nimport json\nthis = game.entity("player")\n` + sources.map((code) => `exec(compile(${JSON.stringify(code)}, "script.py", "exec"), {"game": game, "this": this})`).join("\n") + `
@game.on_start
async def trigger_audit_events():
    await game.wait(0.3)
    for event in [
        {"type": "input", "action": "forward", "state": {"pressed": True, "held": True, "released": False}},
        {"type": "touch", "entityId": "player", "otherId": "door"},
        {"type": "touch_end", "entityId": "player", "otherId": "door"},
        {"type": "interact", "entityId": "player", "actorId": "player"},
        {"type": "respawn", "entityId": "player"},
        {"type": "message", "name": "audit", "payload": 1},
        {"type": "timer", "name": "audit"},
    ]:
        game._event(json.dumps(event))
`;
  await page.evaluate(async (source) => {
    const api = (window as any).__barkTest;
    (window as any).__auditOutput = "";
    api.session.onOutput(({ text }: { text: string }) => (window as any).__auditOutput += text);
    await api.load({ ...api.getDocument(), script: { language: "python", source } });
  }, source);
  await page.getByRole("button", { name: "Prepare Python", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 45000 });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  for (const marker of markers) {
    await expect.poll(() => page.evaluate(() => (window as any).__auditOutput), { message: marker }).toContain(marker);
  }
  expect(await page.evaluate(() => {
    const runtime = (window as any).__barkTest.runtime;
    return [runtime.properties.get(null, "audit_bark_property_set"), runtime.properties.get(null, "audit_bark_property_change")];
  })).toEqual([1, 1]);
  await expect(page.getByTestId("status")).toHaveText("running");
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await page.evaluate(async (compilation) => {
    const api = (window as any).__barkTest;
    (window as any).__auditOutput = "";
    await api.session.prepare(compilation);
    api.session.play();
  }, blockFixture("bark_forever").compilation);
  await expect.poll(() => page.evaluate(() => (window as any).__auditOutput)).toContain("PASS:bark_forever");
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("idle");
});
