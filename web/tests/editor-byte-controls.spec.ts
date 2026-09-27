import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

async function open(page: Page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
}
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("right drag orbits and middle drag pans without transforming the object", async ({ page }) => {
  await open(page);
  const canvas = page.getByLabel("Interactive 3D world", { exact: true });
  const bounds = (await canvas.boundingBox())!;
  await page.getByRole("button", { name: "Resize tool", exact: true }).click();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(400);
  for (const button of ["right", "middle"] as const) {
    const before = await sharp(await canvas.screenshot()).removeAlpha().raw().toBuffer();
    await page.mouse.move(bounds.x + bounds.width * .52, bounds.y + bounds.height * .48);
    await page.mouse.down({ button });
    await page.mouse.move(bounds.x + bounds.width * .77, bounds.y + bounds.height * .62, { steps: 24 });
    await page.mouse.up({ button });
    await page.mouse.move(10, 10);
    const after = await sharp(await canvas.screenshot()).removeAlpha().raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - after[i]) > 15) changed++;
    expect(changed / before.length).toBeGreaterThan(.04);
    await expect(page.getByLabel("position x", { exact: true })).toHaveValue("0");
    await expect(page.getByLabel("scale x", { exact: true })).toHaveValue("1");
  }
});

test("hover trash deletes its own object, Delete removes selection, and World and text editing stay safe", async ({ page }) => {
  await open(page);
  const scene = page.getByRole("region", { name: "Scene objects" });
  const rock = scene.getByRole("button", { name: "Rock", exact: true });
  await rock.hover();
  await scene.getByRole("button", { name: "Delete Rock", exact: true }).click();
  await expect(rock).toHaveCount(0);
  await expect(scene.getByRole("button", { name: "Byte", exact: true })).toHaveAttribute("aria-pressed", "true");
  await scene.getByRole("button", { name: "Crate", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(scene.getByRole("button", { name: "Crate", exact: true })).toHaveCount(0);
  await scene.getByRole("button", { name: /World Global code/ }).click();
  await page.keyboard.press("Delete");
  await expect(scene.getByRole("button", { name: /World Global code/ })).toBeVisible();
  await expect(scene.getByRole("button", { name: "Delete World", exact: true })).toHaveCount(0);
  await scene.getByRole("button", { name: "Byte", exact: true }).click();
  await page.getByLabel("Project name").fill("Editable text");
  await page.getByLabel("Project name").press("Home");
  await page.keyboard.press("Delete");
  await expect(scene.getByRole("button", { name: "Byte", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await scene.getByRole("button", { name: "Flag", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(scene.getByRole("button", { name: "Flag", exact: true })).toHaveCount(0);
});

test("idle keeps moving after hover and thinking, using the textured Byte library model", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const game = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  const model = await (await page.request.get("/models/byte/player.glb")).body();
  // Export embeds model bytes so downloaded games work independently of URLs.
  const embedded = game.project.assets.find((asset: {id: string}) => asset.id === "starter-player").url;
  expect(digest(Buffer.from(embedded.split(",")[1], "base64"))).toBe(digest(model));
  const gltf = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString());
  expect(gltf.images).toHaveLength(2);
  expect(gltf.images.every((image: { bufferView?: number; uri?: string }) => image.bufferView !== undefined && !image.uri)).toBe(true);
  expect(gltf.materials.some((material: {normalTexture?: unknown}) => material.normalTexture)).toBe(true);
  const byte = page.locator("[data-byte-assistant]");
  await expect(byte).toHaveAttribute("data-ready", "true");
  await byte.hover();
  await page.waitForTimeout(700);
  await page.getByLabel("Project name").hover();
  await page.waitForTimeout(750);
  const frames = new Set<string>();
  for (let i = 0; i < 5; i++) {
    frames.add(digest(await byte.screenshot()));
    await page.waitForTimeout(1300);
  }
  expect(frames.size).toBeGreaterThan(3);
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await expect(page.getByLabel("Interactive model preview")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: testInfo.outputPath("new-byte-design.png") });
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: /Language: Blocks/ }).click();
  await page.getByRole("button", { name: "Convert to Python" }).click();
  await page.locator(".cm-content").fill("if True\n    pass");
  await expect(byte).toHaveAttribute("data-state", "thinking");
  await page.waitForTimeout(600);
  await page.locator(".cm-content").fill('print("Fixed")');
  await expect(byte).toHaveAttribute("data-state", "idle");
  await page.waitForTimeout(600);
  const afterThinking = await byte.screenshot();
  await expect.poll(async () => afterThinking.equals(await byte.screenshot())).toBe(false);
  expect(errors).toEqual([]);
});

test("resize spheres are larger and accept a drag near the edge of their hit target", async ({ page }, testInfo) => {
  await open(page);
  await page.getByRole("button", { name: "Resize tool", exact: true }).click();
  await page.mouse.move(10, 10);
  const canvas = page.getByLabel("Interactive 3D world", { exact: true });
  const bounds = (await canvas.boundingBox())!;
  const { data, info } = await sharp(await canvas.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels: {x: number; y: number}[] = [];
  // Locate the pink X sphere in the right half of the actual rendered scene.
  for (let y = Math.ceil(info.height * .3); y < info.height * .7; y++) {
    for (let x = Math.ceil(info.width * .52); x < info.width * .7; x++) {
      const i = (y * info.width + x) * 3;
      const [r, g, b] = data.subarray(i, i + 3);
      if (r > 215 && g > 70 && g < 190 && b > g * .88 && b < g * 1.08 && r - g > 45) pixels.push({ x, y });
    }
  }
  expect(pixels.length).toBeGreaterThan(250);
  expect(Math.max(...pixels.map((p) => p.x)) - Math.min(...pixels.map((p) => p.x))).toBeGreaterThanOrEqual(22);
  const x = pixels.reduce((sum, p) => sum + p.x, 0) / pixels.length;
  const y = pixels.reduce((sum, p) => sum + p.y, 0) / pixels.length;
  await page.screenshot({ path: testInfo.outputPath("larger-resize-handles.png") });
  await page.mouse.move(bounds.x + x + 14, bounds.y + y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + x + 94, bounds.y + y + 8, { steps: 20 });
  await page.mouse.up();
  expect(Number(await page.getByLabel("scale x", { exact: true }).inputValue())).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Undo transform", exact: true }).click();
  await expect(page.getByLabel("scale x", { exact: true })).toHaveValue("1");
});
