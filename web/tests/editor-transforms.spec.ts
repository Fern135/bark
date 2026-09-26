import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ viewport: { width: 1366, height: 768 } });

async function open(page: Page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Move tool", exact: true })).toHaveAttribute("aria-pressed", "true");
  // The starter camera frames Byte; handle offsets are relative to the canvas center.
  await page.waitForTimeout(350);
}
async function point(page: Page, x: number, y: number) {
  const canvas = (await page.getByLabel("Interactive 3D world", { exact: true }).boundingBox())!;
  const factor = canvas.height / 589;
  return { x: canvas.x + canvas.width / 2 + x * factor, y: canvas.y + canvas.height / 2 + y * factor };
}
async function drag(page: Page, x: number, y: number, dx: number, dy: number, release = true) {
  const from = await point(page, x, y), to = await point(page, x + dx, y + dy);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  if (release) await page.mouse.up();
}
const value = (page: Page, name: string) => page.getByLabel(name, { exact: true });

test("rendered move, resize and rotation handles preview, cancel, undo and export", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await drag(page, 60.5, 1.5, 90, 9, false);
  await expect(value(page, "position x")).not.toHaveValue("0");
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(value(page, "position x")).toHaveValue("0");
  await expect(page.getByRole("button", { name: "Undo transform", exact: true })).toBeDisabled();
  await drag(page, 60.5, 1.5, 90, 9);
  const moved = Number(await value(page, "position x").inputValue());
  expect(moved).toBeGreaterThan(0); expect(moved % 0.5).toBe(0);
  await page.keyboard.press("Control+z"); await expect(value(page, "position x")).toHaveValue("0");
  await page.keyboard.press("Control+Shift+z"); await expect(value(page, "position x")).toHaveValue(String(moved));
  await page.getByRole("button", { name: "Undo transform", exact: true }).click();
  await page.getByRole("button", { name: "Resize tool", exact: true }).click();
  await drag(page, 49.5, 3.5, 64, 5);
  const scale = await value(page, "scale x").inputValue();
  expect(Number(scale)).toBeGreaterThan(1);
  await expect(value(page, "scale y")).toHaveValue(scale); await expect(value(page, "scale z")).toHaveValue(scale);
  expect(Number(await value(page, "position x").inputValue())).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Undo transform", exact: true }).click();
  await page.keyboard.down("Alt"); await drag(page, 49.5, 3.5, 64, 5); await page.keyboard.up("Alt");
  await expect(value(page, "position x")).toHaveValue("0");
  await page.getByRole("button", { name: "Undo transform", exact: true }).click();
  await page.getByRole("button", { name: "Rotate tool", exact: true }).click();
  await drag(page, 71.5, 2.5, -38, 13);
  const angle = Number(await value(page, "rotation y").inputValue());
  expect(Math.abs(angle)).toBeGreaterThan(0); expect(angle % 15).toBe(0);
  await expect(value(page, "rotation x")).toHaveValue("0"); await expect(value(page, "rotation z")).toHaveValue("0");
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await pending, game = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(game.project.entities).toHaveLength(43);
  expect(game.project.entities.some((entity: { id: string }) => entity.id.startsWith("editor-"))).toBe(false);
  expect(game.project.entities.find((entity: { id: string }) => entity.id === "player").transform.rotation.y).not.toBe(0);
  expect(errors).toEqual([]);
});

test("viewport selection, numeric history, keyboard scope, camera and narrow layout", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Select tool", exact: true }).click();
  const crate = await point(page, 228.5, 20.5); await page.mouse.click(crate.x, crate.y);
  await expect(page.getByRole("button", { name: "Crate", exact: true })).toHaveAttribute("aria-pressed", "true");
  const before = await value(page, "position x").inputValue();
  await value(page, "position x").fill("3"); await value(page, "position x").press("Enter");
  await expect(page.getByRole("button", { name: "Select tool", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Undo transform", exact: true }).click();
  await expect(value(page, "position x")).toHaveValue(before);
  const sky = await point(page, 240, -140); await page.mouse.click(sky.x, sky.y);
  await expect(page.getByRole("heading", { name: "World settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Byte", exact: true }).click();
  await page.keyboard.press("Digit3"); await expect(page.getByRole("button", { name: "Resize tool", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Transform settings", exact: true }).click();
  await page.getByLabel("Snap to increments").uncheck();
  await page.getByRole("button", { name: "Local", exact: true }).click();
  await page.keyboard.press("Escape");
  const canvas = page.getByLabel("Interactive 3D world", { exact: true });
  const initial = await canvas.screenshot();
  const from = await point(page, 49.5, 3.5), to = await point(page, 109.5, 23.5);
  await page.mouse.move(from.x, from.y); await page.mouse.down({ button: "right" }); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up({ button: "right" });
  expect((await canvas.screenshot()).equals(initial)).toBe(false);
  await expect(value(page, "position x")).toHaveValue("0");
  await expect(value(page, "scale x")).toHaveValue("1");
  await page.setViewportSize({ width: 390, height: 667 });
  await expect(page.getByRole("button", { name: "Resize tool", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= innerWidth, height: document.documentElement.scrollHeight <= innerHeight })) ).toEqual({ width: true, height: true });
});
