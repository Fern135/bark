import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Game } from "../src/lib/games";

async function exported(page: Page): Promise<Game> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}

test("landing Play opens the chosen world in the editor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Open editor", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Start creating", exact: true }).first().click();
  await page.getByLabel("World name").fill("Sunset treasure hunt");
  await page.getByLabel("Setting", { exact: true }).selectOption("sunset");
  await page.getByRole("dialog").getByRole("button", { name: "Play", exact: true }).click();
  await expect(page).toHaveURL(/\/editor\?/);
  await expect(page.getByLabel("Project name")).toHaveValue("Sunset treasure hunt");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  expect((await exported(page)).project.settings.background).toBe("#fbd9cd");
});

test("Byte gives contextual tips and detects problems without Play", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeAudio = window.AudioContext;
    const observed = window as typeof window & { audioContextCount: number };
    observed.audioContextCount = 0;
    window.AudioContext = class extends NativeAudio {
      constructor(options?: AudioContextOptions) { super(options); observed.audioContextCount++; }
    };
  });
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  const byte = page.locator("[data-byte-assistant]");
  const ask = byte.getByRole("button", { name: /Byte assistant/ });
  await expect(byte).toHaveAttribute("data-ready", "true");
  await ask.click();
  await expect(byte.getByRole("status")).toContainText(/Gem|jumping|touch event/);
  expect(await page.evaluate(() => (window as typeof window & { audioContextCount: number }).audioContextCount)).toBe(1);
  await expect(byte.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("byte-tip.png") });
  await byte.getByRole("button", { name: "Dismiss Byte’s tip" }).click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: /Language: Blocks/ }).click();
  await page.getByRole("button", { name: "Convert to Python" }).click();
  const source = page.locator(".cm-content");
  await source.fill('if True\n    print("Hello")');
  await expect(byte).toHaveAttribute("data-state", "thinking");
  await ask.click();
  await expect(byte.getByRole("status")).toContainText(/colon/);
  await page.screenshot({ path: testInfo.outputPath("byte-error-tip.png") });
  await source.fill('while True:\n    print("Hello")');
  await expect(byte.getByRole("status")).toContainText(/freeze your world/);
  await expect(byte).toHaveAttribute("data-state", "thinking");
  await source.fill('print("All fixed!")');
  await page.getByLabel("Project name").hover();
  await expect(byte).toHaveAttribute("data-state", "idle");
  await expect(byte.getByRole("status")).toContainText(/idea|Gem|jumping/);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("publishing uses a centered celebration dialog and restores keyboard focus", async ({ page }, testInfo) => {
  let document: Game;
  let id = "";
  let isPublic = false;
  const user = { user_id: "byte-ui-test-owner", username: "Byte tester", email: "byte@example.test" };
  const saved = () => ({ id, document, name: document.project.name, revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), owner: { user: user.user_id, name: user.username }, role: "owner", collaboration: false, publication: { is_public: isPublic } });
  // Keep publication testing isolated from the developer's real games/account.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === "/api/auth/me/") body = { user };
    else if (path === "/api/auth/csrf/") body = {};
    else if (path === "/api/canvas/games/" && request.method() === "POST") {
      ({ id, document } = request.postDataJSON()); body = saved();
    } else if (/\/api\/canvas\/games\/[^/]+\/$/.test(path)) {
      if (request.method() === "PUT") document = request.postDataJSON();
      body = saved();
    } else if (path.endsWith("/publication/")) {
      isPublic = request.postDataJSON().is_public; body = { is_public: isPublic };
    } else if (!path.endsWith("/cover/")) { await route.abort(); return; }
    await route.fulfill({ json: body });
  });
  await page.goto("/editor");
  const publish = page.getByRole("button", { name: "Publish", exact: true });
  await expect(publish).toBeEnabled();
  const exportButton = page.getByRole("button", { name: "Export JSON", exact: true });
  const publishColor = await publish.evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(await exportButton.evaluate((node) => getComputedStyle(node).backgroundImage)).not.toBe(publishColor);
  await publish.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Your world is public!" })).toBeVisible();
  const confetti = dialog.getByRole("img", { name: "Byte celebrating with confetti" });
  await expect(confetti).toHaveAttribute("data-ready", "true");
  const first = await confetti.screenshot();
  await expect.poll(async () => first.equals(await confetti.screenshot())).toBe(false);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(520);
  expect(Math.abs(bounds.x + bounds.width / 2 - 720)).toBeLessThan(3);
  expect(Math.abs(bounds.y + bounds.height / 2 - 500)).toBeLessThan(3);
  await page.screenshot({ path: testInfo.outputPath("publish-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Published", exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Published", exact: true }).click();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(confetti).toHaveAttribute("data-ready", "true");
  await page.screenshot({ path: testInfo.outputPath("publish-mobile.png") });
  await dialog.getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Your world is private" })).toBeVisible();
  await expect(confetti).toHaveCount(0);
});

test("Byte sends project context for ideas and falls back when AI is unavailable", async ({ page }) => {
  let requests = 0;
  let requestBody: { intent: string; snapshot: { context: { entities: unknown[] } } };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me/") return route.fulfill({ json: { user: { user_id: "byte-ai-test", username: "Tester", email: "test@example.test" } } });
    if (path === "/api/auth/csrf/") return route.fulfill({ json: {} });
    if (path === "/api/coach/review/") {
      const body = route.request().postDataJSON();
      requestBody = body;
      requests++;
      return route.fulfill({ json: { revision: body.revision, suggestion: { category: "idea", message: "Build a treasure hunt using your Gem and Flag.", issueKey: "gem-flag-hunt", line: null, blockId: null } } });
    }
    return route.abort();
  });
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  const byte = page.locator("[data-byte-assistant]");
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect(byte.getByRole("status")).toContainText("Build a treasure hunt using your Gem and Flag.");
  expect(requests).toBe(1);
  expect(requestBody!.intent).toBe("idea");
  expect(requestBody!.snapshot.context.entities.length).toBeGreaterThan(0);
  await byte.getByRole("button", { name: "Turn off AI tips" }).click();
  await expect(byte.getByRole("status")).toContainText("AI tips are off");
  await expect(byte.getByRole("status")).not.toContainText("Build a treasure hunt using your Gem and Flag.");

  // A new browser document resets the in-memory cooldown without a real API call.
  await page.route("**/api/coach/review/", (route) => route.fulfill({ status: 503, headers: { "Retry-After": "120" }, json: { error: "Byte hints are temporarily unavailable." } }));
  await byte.getByRole("button", { name: "Turn on AI tips" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect(byte.getByRole("status")).toContainText("AI is unavailable");
  await expect(byte.getByRole("status")).toContainText(/Gem|jumping|touch event/);
});

test("editing code triggers AI review before Play and displays its improvement", async ({ page }) => {
  let reviewed = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me/") return route.fulfill({ json: { user: { user_id: "byte-auto-test", username: "Tester", email: "test@example.test" } } });
    if (path === "/api/auth/csrf/") return route.fulfill({ json: {} });
    if (path === "/api/coach/review/") {
      const body = route.request().postDataJSON();
      expect(body.intent).toBe("review");
      expect(body.snapshot.python).toContain("while True:");
      reviewed = true;
      return route.fulfill({ json: { revision: body.revision, suggestion: { category: "improvement", message: "Add await game.next_frame() so your loop lets the world update.", issueKey: "loop-yield", line: 1, blockId: null } } });
    }
    return route.abort();
  });
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: /Language: Blocks/ }).click();
  await page.getByRole("button", { name: "Convert to Python" }).click();
  await page.locator(".cm-content").fill('while True:\n    print("Hello")');
  const byte = page.locator("[data-byte-assistant]");
  await expect(byte).toHaveAttribute("data-state", "thinking");
  await expect.poll(() => reviewed).toBe(true);
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect(byte.getByRole("status")).toContainText("Add await game.next_frame()");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
});
