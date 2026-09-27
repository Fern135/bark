import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Game } from "../src/components/editor/use-editor";

async function importGame(page: Page, game: Game) {
  await page.getByLabel("Import game JSON").setInputFiles({
    name: "byte-test.bark.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(game)),
  });
}

test("Byte animates, reacts to hover and script errors, and recovers across editor tabs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/editor");
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeEnabled();
  const byte = page.locator("[data-byte-assistant]");
  await expect(byte).toHaveAttribute("data-ready", "true");
  await expect(byte).toHaveAttribute("data-state", "idle");

  // Exercise the real Rive canvas, not just the React state label.
  const firstFrame = await byte.screenshot();
  await expect.poll(async () => firstFrame.equals(await byte.screenshot())).toBe(false);
  await byte.hover();
  await expect(byte).toHaveAttribute("data-state", "hover");
  await page.getByLabel("Project name").hover();
  await expect(byte).toHaveAttribute("data-state", "idle");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const saved: Game = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const broken: Game = { ...saved, script: { language: "python", source: "this is invalid python !!!" } };
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await importGame(page, broken);
  await play.click();
  await expect(page.getByLabel("Script output")).toContainText(/invalid|SyntaxError/i);
  await expect(byte).toHaveAttribute("data-state", "thinking");
  await byte.hover();
  await expect(byte).toHaveAttribute("data-state", "thinking");
  await page.getByLabel("Project name").hover();
  const thinkingFrame = await byte.screenshot();
  await expect.poll(async () => thinkingFrame.equals(await byte.screenshot())).toBe(false);

  for (const tab of ["Design", "Viewport", "Code"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(byte).toHaveCount(1);
    await expect(byte).toHaveAttribute("data-ready", "true");
    await expect(byte).toHaveAttribute("data-state", "thinking");
  }

  // Fixing the code clears the existing diagnostic and returns Byte to idle.
  const source = page.locator(".cm-content");
  await source.fill('print("Fixed!")');
  await expect(byte).toHaveAttribute("data-state", "idle");
  await page.keyboard.press("Tab");
  await byte.getByRole("button", { name: /Byte assistant/ }).focus();
  await expect(byte).toHaveAttribute("data-state", "hover");
  await source.focus();
  await expect(byte).toHaveAttribute("data-state", "idle");

  // Errors emitted asynchronously by the running Python script use the same state.
  await importGame(page, { ...saved, script: {
    language: "python",
    source: 'from bark import game\n@game.on_start\nasync def start():\n    raise ValueError("BYTE_RUNTIME_ERROR")\n',
  } });
  await play.click();
  await expect(page.getByLabel("Script output")).toContainText("BYTE_RUNTIME_ERROR");
  await expect(byte).toHaveAttribute("data-state", "thinking");
  await importGame(page, saved);
  await expect(byte).toHaveAttribute("data-state", "idle");
  expect(errors).toEqual([]);
});

test("Byte keeps a still image if the Rive asset fails to load", async ({ page }) => {
  await page.route("**/animations/byte.riv", (route) => route.abort());
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  const byte = page.locator("[data-byte-assistant]");
  await expect(byte).toHaveAttribute("data-ready", "false");
  await expect(byte.locator("img")).toBeVisible();
});
