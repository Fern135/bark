import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { sampleDocument } from "../../playground/sample";
import { defineEntity } from "@bark/engine";

const importFile = (page: Page, value: unknown) => page.locator('input[type="file"]').setInputFiles({ name: "portable.bark.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
async function exportFile(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export game ↗" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.bark\.json$/);
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}

test("portable export loads GLB, PNG and JPEG without original URLs, defers Python and restores fresh sessions", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/"); await expect(page.getByRole("button", { name: "Prepare Python", exact: true })).toBeEnabled();
  const doc = sampleDocument();
  doc.project.name = "Portable fixtures";
  const glb = await readFile(new URL("../../../engine/test/fixtures/gem.glb", import.meta.url));
  const png = await readFile(new URL("../../../engine/test/fixtures/tile.png", import.meta.url));
  const jpeg = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 2; c.getContext("2d")!.fillRect(0, 0, 2, 2); return c.toDataURL("image/jpeg"); });
  await page.route("**/fixture.glb", (r) => r.fulfill({ body: glb, contentType: "model/gltf-binary" }));
  await page.route("**/fixture.png", (r) => r.fulfill({ body: png, contentType: "image/png" }));
  doc.project.assets = [{ id: "gem-model", type: "model", url: `${baseURL}/fixture.glb` }, { id: "tile", type: "texture", url: `${baseURL}/fixture.png` }, { id: "photo", type: "texture", url: jpeg }];
  doc.project.materials = [{ id: "tile-material", color: "#FFFFFF", textureId: "tile" }, { id: "photo-material", color: "#FFFFFF", textureId: "photo" }];
  doc.project.entities.push(defineEntity({ id: "model-fixture", visual: { kind: "model", assetId: "gem-model" }, transform: { position: { x: 3, y: 1, z: 0 } } }), defineEntity({ id: "jpeg-fixture", visual: { kind: "box", size: { x: 1, y: 1, z: 1 }, materialId: "photo-material" } }));
  const floor = doc.project.entities.find((e) => e.id === "floor")!;
  if (floor.visual) floor.visual.materialId = "tile-material";
  doc.script = { language: "python", blocksBackup: doc.script.language === "blocks" ? doc.script.workspace : {}, source: `from bark import game
print("module setup")
@game.on_start
async def start():
    score = await game.properties.get("score", 0)
    await game.set_hud("score", "Score", score)
    await game.properties.set("score", score + 1)
    print("fresh session", score)
@game.on_input("jump")
async def jump(state):
    if state.pressed:
        await game.set_hud("score", "Score", 99)
` };
  await importFile(page, doc); await expect(page.locator(".project-title")).toContainText("Portable fixtures");
  const saved = await exportFile(page);
  expect(saved.script.blocksBackup).toBeTruthy();
  expect(saved.project.assets.map((a: { url: string }) => a.url.split(",")[0])).toEqual(["data:model/gltf-binary;base64", "data:image/png;base64", "data:image/jpeg;base64"]);
  await page.unroute("**/fixture.glb"); await page.unroute("**/fixture.png");
  const external: string[] = [];
  await page.route("**/fixture.*", (r) => { external.push(r.request().url()); return r.abort(); });
  const python: string[] = []; page.on("request", (r) => { if (r.url().includes("/pyodide/")) python.push(r.url()); });
  await page.goto("/player/"); await expect(page.getByLabel("Load game JSON")).toBeEnabled();
  await importFile(page, saved); await expect(page.getByTestId("player-status")).toHaveText("ready");
  expect(python).toEqual([]); await expect(page.getByTestId("player-output")).not.toContainText("module setup");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByTestId("player-status")).toHaveText("running", { timeout: 45_000 });
  await expect(page.getByTestId("hud-score")).toHaveText("Score: 0");
  await expect(page.getByTestId("player-output")).toContainText("fresh session 0");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByTestId("player-status")).toHaveText("paused");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("link", { name: "Script Lab ↗" }).focus(); await page.keyboard.press("Space");
  await expect(page.getByTestId("hud-score")).toHaveText("Score: 0");
  await page.getByLabel("Game viewport").click(); await page.keyboard.press("Space");
  await expect(page.getByTestId("hud-score")).toHaveText("Score: 99");
  await importFile(page, { ...saved, version: 2 }); await expect(page.getByRole("alert")).toContainText("Unsupported");
  await expect(page.getByTestId("player-status")).toHaveText("running");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Portable fixtures");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(page.getByTestId("player-status")).toHaveText("running", { timeout: 45_000 });
  await expect(page.getByTestId("hud-score")).toHaveText("Score: 0");
  await expect(page.getByTestId("player-output")).toContainText("fresh session 0");
  await page.setViewportSize({ width: 920, height: 720 });
  await expect.poll(() => page.getByLabel("Game viewport").evaluate((c: HTMLCanvasElement) => Math.abs(c.width - c.clientWidth))).toBeLessThan(3);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByTestId("player-status")).toHaveText("ready"); await expect(page.getByTestId("hud-score")).toHaveCount(0);
  expect(external).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: `test-results/player-${baseURL?.includes("4174") ? "production" : "development"}.png` });
});

test("exported blocks play the coin game, show targeting, animate the gate and restart", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/"); await expect(page.getByRole("button", { name: "Prepare Python", exact: true })).toBeEnabled();
  const saved = await exportFile(page);
  await page.goto("/player/"); await expect(page.getByLabel("Load game JSON")).toBeEnabled(); await importFile(page, saved);
  await expect(page.getByTestId("player-status")).toHaveText("ready"); await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByTestId("player-status")).toHaveText("running", { timeout: 45_000 });
  await expect(page.getByTestId("hud-score")).toContainText("Score: 0");
  await page.getByLabel("Game viewport").click(); await page.keyboard.down("w");
  await expect(page.getByTestId("hud-score")).toContainText("Score: 6");
  await expect(page.locator(".feedback")).toContainText("E · Open gate");
  await page.keyboard.up("w"); await page.keyboard.press("e");
  await expect(page.locator(".feedback")).toContainText("Gate open! Follow the path to the goal.");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByTestId("player-status")).toHaveText("ready");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByTestId("hud-score")).toContainText("Score: 0", { timeout: 45_000 });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const second = structuredClone(saved); second.project.name = "Replacement game";
  await importFile(page, second); await expect(page.getByRole("heading", { level: 1 })).toHaveText("Replacement game");
});

test("built player entry point loads its worker and repeated disposal cancels initialization and preparation", async ({ page, baseURL }) => {
  test.skip(baseURL?.includes("4174") ?? false, "Built library consumer uses Vite's module resolver; production player is covered separately.");
  test.setTimeout(120_000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/player/"); await expect(page.getByLabel("Load game JSON")).toBeEnabled();
  const doc = sampleDocument(); doc.script = { language: "python", source: "print('built worker ready')" };
  const result = await page.evaluate(async (json) => {
    const path = "/dist/player.js";
    const { createGamePlayer, parseGame, serializeGame } = await import(/* @vite-ignore */ path);
    const wasmModule = "/node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
    const { default: havokWasmUrl } = await import(/* @vite-ignore */ wasmModule);
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 400; document.body.append(canvas);
    const aborted = new AbortController(); aborted.abort();
    let abortRejected = false;
    try { await createGamePlayer({ canvas, havokWasmUrl, pythonRuntimeUrl: "/pyodide/", signal: aborted.signal }); } catch { abortRejected = true; }
    let output = "", cancelled = false;
    for (let i = 0; i < 3; i++) {
      const p = await createGamePlayer({ canvas, havokWasmUrl, pythonRuntimeUrl: "/pyodide/" });
      await p.load(await serializeGame(await parseGame(json)));
      const printed = new Promise<void>((resolve) => p.onOutput((o: { text: string }) => { output += o.text; if (o.text.includes("built worker ready")) resolve(); }));
      const playing = p.play();
      if (i === 0) { p.dispose(); try { await playing; } catch { cancelled = true; } }
      else { await playing; await printed; p.stop(); }
      p.dispose(); p.dispose();
    }
    canvas.remove(); return { abortRejected, cancelled, output };
  }, JSON.stringify(doc));
  expect(result.abortRejected).toBe(true); expect(result.cancelled).toBe(true);
  expect(result.output.match(/built worker ready/g)).toHaveLength(2); expect(errors).toEqual([]);
});
