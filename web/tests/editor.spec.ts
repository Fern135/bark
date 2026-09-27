import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Game } from "../src/components/editor/use-editor";

async function open(page: Page) {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/editor");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
}
async function exportGame(page: Page): Promise<Game> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.bark\.json$/);
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}
async function importGame(page: Page, game: unknown) {
  await page.getByLabel("Import game JSON").setInputFiles({
    name: "test.bark.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(game)),
  });
}

test("edit, gallery, GLB upload, export/import and invalid import preserve authored content", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.getByLabel("Project name").fill("A little adventure");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Sunny");
  await page.getByRole("button", { name: "Viewport", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sunny", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("position x", { exact: true }).fill("2");
  await page.getByLabel("position x", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Add object", exact: true }).click();
  await page
    .getByRole("button", { name: "Object Make your world yours" })
    .click();
  await page.getByRole("button", { name: "Choose a model" }).click();
  await page.getByRole("searchbox", { name: "Search models" }).fill("pebble");
  await expect(
    page.getByRole("button", { name: "Pebble Object", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Oak tree Object", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Pebble Object", exact: true })
    .click();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("textbox", { name: "Object name" }).fill("Moon rock");
  await page.getByRole("button", { name: "Add to world" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Viewport", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Moon rock", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add object", exact: true }).click();
  await page
    .getByRole("button", { name: "Object Make your world yours" })
    .click();
  await page.getByRole("button", { name: "Choose a model" }).click();
  await page.getByLabel("Upload GLB model").setInputFiles({
    name: "broken.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.locator("p[role=alert]")).toContainText("GLB");
  await page
    .getByLabel("Upload GLB model")
    .setInputFiles("../engine/test/fixtures/gem.glb");
  await expect(
    page.getByRole("heading", { name: "gem", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("textbox", { name: "Object name" }).fill("Uploaded gem");
  await page.getByRole("button", { name: "Add to world" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await exportGame(page);
  expect(saved.project.name).toBe("A little adventure");
  expect(
    saved.project.entities.find((e) => e.name === "Sunny")?.transform.position
      .x,
  ).toBe(2);
  expect(saved.project.entities.some((e) => e.name === "Moon rock")).toBe(true);
  expect(saved.project.entities.some((e) => e.name === "Uploaded gem")).toBe(
    true,
  );
  expect(saved.project.assets[0].url).toMatch(
    /^data:model\/gltf-binary;base64,/,
  );
  await importGame(page, { version: 99 });
  await expect(page.locator("p[role=alert]")).toContainText("Unsupported");
  await expect(page.getByLabel("Project name")).toHaveValue(
    "A little adventure",
  );
  await importGame(page, saved);
  await expect(page.getByRole("status").filter({ hasText: "Sign in to save" })).toBeVisible();
  expect(await exportGame(page)).toEqual(saved);
  await page.getByRole("button", { name: "Viewport", exact: true }).click();
  await page.getByRole("button", { name: "Moon rock", exact: true }).click();
  await page.getByRole("button", { name: "Delete object" }).click();
  expect(
    (await exportGame(page)).project.entities.some(
      (e) => e.name === "Moon rock",
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Sunny", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Gallery & upload", exact: true }).click();
  await page
    .getByRole("button", { name: "Wooden crate Object", exact: true })
    .click();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("button", { name: "Replace model" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const replaced = (await exportGame(page)).project.entities.find(
    (e) => e.id === "player",
  )!;
  expect(replaced.character).toEqual(
    saved.project.entities.find((e) => e.id === "player")?.character,
  );
  expect(replaced.transform.position.x).toBe(2);
  expect(replaced.visual?.kind).toBe("model");
  expect(errors).toEqual([]);
});

test("real Blockly and Python playback, conversion, pause/resume, Stop and error recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(
    page.locator(".block-editor > .injectionDiv > .blocklySvg"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText("Hello, world!");
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeEnabled();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: /Language: Blocks/ }).click();
  await page.getByRole("button", { name: "Convert to Python" }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  const converted = await exportGame(page);
  expect(converted.script.language).toBe("python");
  if (converted.script.language !== "python")
    throw new Error("Expected Python");
  expect(converted.script.blocksBackup).toBeTruthy();
  await page.getByRole("button", { name: /Language: Python/ }).click();
  await page.getByRole("button", { name: "Restore blocks" }).click();
  await expect(
    page.locator(".block-editor > .injectionDiv > .blocklySvg"),
  ).toBeVisible();
  const game = await exportGame(page);
  game.script = {
    language: "python",
    source:
      'from bark import game\n@game.on_start\nasync def start():\n    await game.properties.set("runtime_only", True)\n    await game.entity("player").teleport(4, 2, 0)\n    await game.set_hud("status", "Status", "PLAY_OK")\n    print("PLAY_OK")\n',
  };
  await importGame(page, game);
  await expect(page.locator(".cm-content")).toContainText("runtime_only");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      page.getByText("Status: PLAY_OK", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Project name")).toBeDisabled();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const after = await exportGame(page);
    expect(after.project.properties?.runtime_only).toBeUndefined();
    expect(
      after.project.entities.find((e) => e.id === "player")?.transform.position,
    ).toEqual(
      game.project.entities.find((e) => e.id === "player")?.transform.position,
    );
  }
  game.script = {
    language: "python",
    source:
      'from bark import game\n@game.on_start\nasync def start():\n    await game.properties.set("runtime_only", True)\n    raise ValueError("RUNTIME_FAILURE")\n',
  };
  await importGame(page, game);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("RUNTIME_FAILURE");
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("After recovery");
  const recovered = await exportGame(page);
  expect(recovered.project.entities.find((e) => e.id === "player")?.name).toBe(
    "After recovery",
  );
  expect(recovered.project.properties?.runtime_only).toBeUndefined();
  game.script = { language: "python", source: "this is invalid python !!!" };
  await importGame(page, game);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    /invalid|SyntaxError/i,
  );
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test("editor fits short and narrow windows and every scene object stays reachable without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page);
  const scene = page.getByRole("region", { name: "Scene objects" });
  const cards = scene.locator('button[aria-pressed]');
  const names: string[] = [];
  for (let i = 0; i < 10; i++) {
    names.push(...await cards.allTextContents());
    const next = scene.getByRole("button", { name: "Next objects" });
    if (!(await next.count()) || !(await next.isEnabled())) break;
    const first = await cards.first().textContent();
    await next.click();
    await expect(cards.first()).not.toHaveText(first!);
  }
  expect(names).toHaveLength(16);
  expect(names.map((name) => name.trim())).toContain("Meadow");
  await scene.getByRole("button", { name: "Tent", exact: true }).click();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await expect(scene.getByRole("button", { name: "Tent", exact: true })).toHaveAttribute("aria-pressed", "true");

  for (const [width, height] of [[1586, 992], [1366, 768], [1280, 720], [390, 667]]) {
    await page.setViewportSize({ width, height });
    for (const view of ["Viewport", "Design", "Code"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(page.locator("main")).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollHeight <= innerHeight && doc.scrollWidth <= innerWidth;
      })).toBe(true);
      if (width > 950) {
        await expect(scene.getByRole("button", { name: "Add object", exact: true })).toBeInViewport({ ratio: 1 });
        const bounds = await scene.boundingBox();
        for (const card of await cards.all()) {
          const cardBounds = await card.boundingBox();
          expect(cardBounds!.y + cardBounds!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
        }
      }
    }
  }
});

test("reference layouts, thumbnail rendering, dialogs and narrow-screen drawers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1586, height: 992 });
  await open(page);
  const images = page.locator("button[aria-pressed] img");
  await expect(images.first()).toBeVisible();
  await page.screenshot({
    path: "design/editor-viewport-preview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await expect(page.getByText(/Preparing preview/)).toHaveCount(0);
  await page.waitForTimeout(750);
  await page.screenshot({
    path: "design/editor-design-preview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(
    page.locator(".block-editor > .injectionDiv > .blocklySvg"),
  ).toBeVisible();
  await page.screenshot({
    path: "design/editor-code-preview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Add object", exact: true }).click();
  await page.screenshot({
    path: "design/editor-add-preview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Choose a model" }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByText(/Preparing preview/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Customize", exact: true })).toBeInViewport();
  await page.screenshot({
    path: "design/editor-gallery-preview.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add object", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("button", { name: "Viewport", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Scene", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "design/editor-tablet-preview.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Scene", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "design/editor-mobile-preview.png",
    fullPage: true,
  });
});

test("model studio stays out of saves; searchable palette supports drag, undo and mobile access", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const before = await exportGame(page);
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await expect(page.getByText(/Preparing preview/)).toHaveCount(0);
  await page.getByRole("button", { name: "Reset preview camera" }).click();
  expect((await exportGame(page)).project).toEqual(before.project);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  // A hat still owns a real statement connection even without a visible C frame.
  const starterStacks = page.locator("svg.blocklySvg .blocklyBlockCanvas > .blocklyDraggable");
  const firstAction = starterStacks.first().locator(":scope > .blocklyDraggable").first();
  const actionBounds = await firstAction.locator(":scope > .blocklyPath").boundingBox();
  expect(actionBounds).not.toBeNull();
  await page.mouse.move(actionBounds!.x + 20, actionBounds!.y + 25);
  await page.mouse.down();
  await page.mouse.move(actionBounds!.x + 165, actionBounds!.y + 190, { steps: 20 });
  await page.mouse.up();
  await expect(starterStacks).toHaveCount(3);
  await page.getByRole("button", { name: "Undo block edit" }).click();
  await expect(starterStacks).toHaveCount(2);
  await page.getByLabel("Search blocks").fill("when game");
  const flyout = page.locator("svg.blocklyFlyout:not(.blocklyTrashcanFlyout)");
  await expect(flyout).toContainText(/when\s+game\s+starts/);
  const roots = page.locator(
    "svg.blocklySvg .blocklyBlockCanvas > .blocklyDraggable",
  );
  const count = await roots.count();
  await flyout
    .locator(".blocklyBlockCanvas > .blocklyDraggable")
    .first()
    .dragTo(page.locator("svg.blocklySvg"), {
      targetPosition: { x: 750, y: 500 },
    });
  await expect(roots).toHaveCount(count + 1);
  await page.getByRole("button", { name: "Undo block edit" }).click();
  await expect(roots).toHaveCount(count);
  await page.getByRole("button", { name: "Redo block edit" }).click();
  await expect(roots).toHaveCount(count + 1);
  await page.getByLabel("Search blocks").fill("no-such-block");
  await expect(flyout).toContainText("No matching blocks");
  await page.getByRole("button", { name: "Undo block edit" }).click();
  await page.getByLabel("Search blocks").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(flyout).toBeHidden();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await expect(flyout).toBeVisible();
  await page.getByRole("button", { name: "Hide blocks", exact: true }).click();
  await expect(flyout).toBeHidden();
  await page.screenshot({
    path: "design/editor-mobile-code-preview.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A file exported by the primitive-only editor still edits and resets safely.
  before.project.assets = [];
  before.project.entities = before.project.entities.filter((e) =>
    ["player", "ground"].includes(e.id),
  );
  before.project.entities.find((e) => e.id === "player")!.visual = {
    kind: "capsule",
    size: { x: 1, y: 2, z: 1 },
    color: "#FFAA45",
  };
  await importGame(page, before);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset appearance", exact: true })
    .click();
  expect(
    (await exportGame(page)).project.entities.find((e) => e.id === "player")
      ?.visual?.kind,
  ).toBe("capsule");
  expect(errors).toEqual([]);
});
