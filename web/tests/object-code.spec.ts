import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function exported(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}
async function open(page: Page) {
  page.on("dialog", (d) => d.accept());
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
}
async function edit(page: Page, source: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(source);
}

test("selection opens independent object/global code and preserves local undo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const original = await exported(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByLabel("Code browser")).toHaveValue("player");
  await expect(page.getByRole("heading", { name: /Object code/ })).toBeVisible();
  expect((await exported(page)).objectScripts).toEqual({});
  const game = { ...original, version: 2, script: { language: "python", source: "print('GLOBAL')\n" }, objectScripts: { player: { language: "python", source: "print('PLAYER')\n" } } };
  game.project.entities.push({ ...structuredClone(game.project.entities.find((entity: { id: string }) => entity.id === "player")), id: "global", name: "Object named global", character: null, body: null, collider: null });
  (game.objectScripts as Record<string, { language: string; source: string }>).global = { language: "python", source: "print('ID_GLOBAL')\n" };
  await page.getByLabel("Import game JSON").setInputFiles({ name: "contexts.bark.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(game)) });
  await expect(page.locator(".cm-content")).toContainText("PLAYER");
  await edit(page, "print('OBJECT_EDIT')\n");
  await page.getByLabel("Code browser").selectOption("");
  await expect(page.locator(".cm-content")).toContainText("GLOBAL");
  await edit(page, "print('GLOBAL_EDIT')\n");
  await page.getByLabel("Code browser").selectOption("global");
  await expect(page.locator(".cm-content")).toContainText("ID_GLOBAL");
  await page.getByLabel("Code browser").selectOption("");
  await expect(page.locator(".cm-content")).toContainText("GLOBAL_EDIT");
  await page.getByLabel("Code browser").selectOption("player");
  await expect(page.locator(".cm-content")).toContainText("OBJECT_EDIT");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toContainText("PLAYER");
  const saved = await exported(page);
  expect(saved.script.source).toContain("GLOBAL_EDIT");
  expect(saved.objectScripts.player.source).toContain("PLAYER");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText("GLOBAL_EDIT", { timeout: 45000 });
  await expect(page.getByLabel("Script output")).toContainText("PLAYER");
  await page.screenshot({ path: "test-results/object-code.png" });
  expect(errors).toEqual([]);
});

test("empty object code plays and conversion affects only the active context", async ({ page }) => {
  await open(page);
  const before = await exported(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("textbox", { name: "Search blocks" }).fill("interact as actor");
  await expect(page.locator(".blocklyFlyout .blocklyText").filter({ hasText: "this object" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText("Hello, world!", { timeout: 45_000 });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: /Language: Blocks/ }).click();
  await page.getByRole("button", { name: /Convert to Python/ }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await edit(page, "from bark import game\n@game.on_start\nasync def start():\n    print(this.id)\n");
  const after = await exported(page);
  expect(after.script).toEqual(before.script);
  expect(after.objectScripts.player.language).toBe("python");
  expect(after.objectScripts.player.blocksBackup).toBeTruthy();
  await page.getByLabel("Code browser").selectOption("");
  await expect(page.getByRole("heading", { name: "World · Global code" })).toBeVisible();
});


test("renaming and diagnostic navigation preserve the owning script", async ({ page }) => {
  await open(page);
  const doc = await exported(page);
  doc.version = 2;
  doc.script = { language: "python", source: "# global\n" };
  doc.objectScripts = { player: { language: "python", source: "from bark import game\n@game.on_start\nasync def start():\n    raise ValueError('owner error')\n" } };
  await page.getByLabel("Import game JSON").setInputFiles({ name: "diagnostic.bark.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed owner");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Renamed owner/ })).toBeVisible();
  await page.getByLabel("Code browser").selectOption("");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Script output").getByRole("alert")).toContainText("Renamed owner · line 4: owner error", { timeout: 45_000 });
  await page.getByRole("button", { name: "Open code", exact: true }).click();
  await expect(page.getByLabel("Code browser")).toHaveValue("player");
  await expect(page.locator(".cm-content")).toContainText("owner error");
  const saved = await exported(page);
  expect(saved.objectScripts.player.source).toBe(doc.objectScripts.player.source);
});


test("Blocks history, child navigation and deletion stay scoped to their owner", async ({ page }) => {
  await open(page);
  const doc = await exported(page);
  doc.version = 2;
  doc.script = { language: "blocks", workspace: {} };
  const owner = doc.project.entities.find((entity: { id: string }) => entity.id === "player");
  doc.project.entities.push({ ...structuredClone(owner), id: "child", name: "Child object", parentId: "player", character: null, body: null, collider: null });
  const workspace = { blocks: { languageVersion: 0, blocks: [{ type: "bark_start", id: "start", x: 20, y: 20, inputs: { DO: { block: { type: "text_print", id: "print", inputs: { TEXT: { shadow: { type: "text", id: "text", fields: { TEXT: "Before edit" } } } } } } } }] } };
  doc.objectScripts = { player: { language: "blocks", workspace }, child: { language: "python", source: "print(this.id)\n" } };
  await page.getByLabel("Import game JSON").setInputFiles({ name: "history.bark.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.locator('.blocklyText').filter({ hasText: "Before edit" }).dblclick();
  await page.locator('.blocklyHtmlInput').fill("After edit");
  await page.locator('.blocklyHtmlInput').press("Enter");
  await page.getByLabel("Code browser").selectOption("child");
  await expect(page.locator(".cm-content")).toContainText("this.id");
  await page.getByLabel("Code browser").selectOption("player");
  await expect(page.locator('.blocklyText').filter({ hasText: "After edit" })).toBeVisible();
  await page.getByRole("button", { name: "Undo block edit", exact: true }).click();
  await expect(page.locator('.blocklyText').filter({ hasText: "Before edit" })).toBeVisible();
  await page.getByRole("button", { name: "Viewport", exact: true }).click();
  await page.getByRole("button", { name: "Delete object", exact: true }).click();
  const saved = await exported(page);
  expect(saved.objectScripts).toEqual({});
  expect(saved.project.entities.some((entity: { id: string }) => entity.id === "child")).toBe(false);
});
