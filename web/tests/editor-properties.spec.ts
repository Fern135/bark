import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function open(page: Page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
}
const propertyPanel = (page: Page) => page.getByRole("region", { name: "Object properties", exact: true });
async function section(page: Page, name: string) {
  const button = propertyPanel(page).getByRole("button", { name, exact: true });
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}
async function number(page: Page, label: string, next: string) {
  const input = propertyPanel(page).getByLabel(label, { exact: true });
  await input.fill(next); await input.press("Enter");
}

test("selected properties edit, restrict, hide, save, reload and delete objects", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const panel = propertyPanel(page);
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill("Scout");
  await expect(page.getByRole("button", { name: "Scout", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByLabel("rotation x", { exact: true })).toBeDisabled();
  await expect(panel.getByLabel("rotation z", { exact: true })).toBeDisabled();
  await number(page, "scale x", "2");
  await expect(panel.getByLabel("scale y", { exact: true })).toHaveValue("2");
  await expect(panel.getByLabel("scale z", { exact: true })).toHaveValue("2");
  await page.getByRole("button", { name: "Undo transform", exact: true }).click();
  await expect(panel.getByLabel("scale x", { exact: true })).toHaveValue("1");
  await number(page, "scale x", "0");
  await expect(panel.getByLabel("scale y", { exact: true })).toHaveValue("0.01");
  await page.getByRole("button", { name: "Undo transform", exact: true }).click();
  await section(page, "Collision");
  await expect(panel.getByRole("switch", { name: "Solid (collides with objects)" })).toBeDisabled();
  await section(page, "Appearance");
  await panel.getByRole("switch", { name: "Visible", exact: true }).uncheck();
  await expect(page.getByRole("button", { name: "Scout", exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("switch", { name: "Visible", exact: true }).check();
  await panel.getByRole("button", { name: "Gallery & upload", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Crate", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Crate");
  await number(page, "scale x", "1.5");
  await expect(panel.getByLabel("scale y", { exact: true })).toHaveValue("1");
  await section(page, "Collision");
  await panel.getByRole("switch", { name: "Solid (collides with objects)" }).uncheck();
  await section(page, "Appearance");
  await panel.getByRole("switch", { name: "Visible", exact: true }).uncheck();
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const json = await readFile((await (await pending).path())!, "utf8"), saved = JSON.parse(json);
  const crate = saved.project.entities.find((entity: { id: string }) => entity.id === "crate");
  expect(crate.visible).toBe(false); expect(crate.collider).toBe(null); expect(crate.transform.scale).toEqual({ x: 1.5, y: 1, z: 1 });
  await page.getByLabel("Import game JSON").setInputFiles({ name: "properties.bark.json", mimeType: "application/json", buffer: Buffer.from(json) });
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Crate", exact: true }).click();
  await section(page, "Appearance"); await expect(panel.getByRole("switch", { name: "Visible", exact: true })).not.toBeChecked();
  await panel.getByRole("button", { name: "Delete object", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "World settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crate", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Scout", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Name", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Name", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("properties and scene fit the viewport, and drawers retain selection on smaller screens", async ({ page }) => {
  await open(page);
  for (const [width, height] of [[1586, 992], [1366, 768], [1280, 720], [1180, 720]]) {
    await page.setViewportSize({ width, height });
    const panel = propertyPanel(page), bounds = (await panel.boundingBox())!;
    const viewport = (await page.getByLabel("Interactive 3D world", { exact: true }).boundingBox())!;
    const scene = (await page.getByRole("region", { name: "Scene objects", exact: true }).boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThan(viewport.x);
    expect(viewport.x + viewport.width).toBeLessThan(scene.x);
    for (const name of ["Transform", "Appearance", "Collision"]) {
      await section(page, name);
      // Wait for the height transition, then check every section and the fixed footer.
      await page.waitForTimeout(220);
      const footer = (await panel.getByRole("button", { name: "Delete object", exact: true }).boundingBox())!;
      const last = (await panel.getByRole("button", { name: "Collision", exact: true }).boundingBox())!;
      expect(last.y + last.height).toBeLessThanOrEqual(footer.y);
      expect(await panel.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1100, height: 768 });
  await expect(propertyPanel(page)).toBeVisible();
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Crate", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(propertyPanel(page).getByLabel("Name", { exact: true })).toHaveValue("Crate");
  await page.setViewportSize({ width: 390, height: 667 });
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Name", { exact: true })).toHaveValue("Crate");
  await page.screenshot({ path: "design/editor-properties-mobile.png" });
  expect(await page.getByRole("dialog").evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Properties", exact: true })).toBeFocused();
});
