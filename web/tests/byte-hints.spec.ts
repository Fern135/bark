import { expect, test, type Page } from "@playwright/test";
import type { ByteRequest } from "../src/lib/byte-hints";

async function open(page: Page) {
  await page.route("**/api/auth/me/", (route) => route.fulfill({ json: { user: { user_id: "byte-test", username: "Builder", email: "builder@example.test" } } }));
  await page.route("**/api/auth/csrf/", (route) => route.fulfill({ json: {} }));
  let revision = 0;
  await page.route("**/api/canvas/**", (route) => {
    const body = route.request().postDataJSON();
    const document = body.document ?? body;
    return route.fulfill({ json: { id: body.id ?? route.request().url().split("/").at(-2), document, revision: ++revision, name: document.project.name, owner: { user: "byte-test", name: "Builder" }, role: "owner", collaboration: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
  });
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Code browser").selectOption("");
  await expect(page.getByRole("checkbox", { name: "Byte hints" })).toBeChecked();
}

async function python(page: Page) {
  await page.getByRole("button", { name: /Language: Blocks/ }).click();
  await page.getByRole("button", { name: "Convert to Python" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

test("Python hints debounce, preserve focus, dismiss, fit mobile and remember the toggle", async ({ page }) => {
  const requests: ByteRequest[] = [];
  await page.route("**/api/coach/review/", async (route) => {
    const body = route.request().postDataJSON() as ByteRequest; requests.push(body);
    await route.fulfill({ json: { revision: body.revision, suggestion: { category: "bug", message: "Add await before game.wait(1) so your handler pauses.", issueKey: "missing-await", line: 4, blockId: null } } });
  });
  await open(page); await python(page);
  const code = page.locator(".cm-content");
  await code.fill("from bark import game\n@game.on_start\nasync def start():\n    game.wait(1)");
  await page.waitForTimeout(3000); expect(requests).toHaveLength(0);
  await expect(page.getByRole("region", { name: "Byte suggestion" })).toBeVisible({ timeout: 15_000 });
  await expect(code).toBeFocused();
  expect(requests).toHaveLength(1);
  expect(requests[0].snapshot.language).toBe("python");
  expect(requests[0].snapshot.python).toContain("game.wait(1)");
  await page.screenshot({ path: "test-results/byte-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const card = await page.getByRole("region", { name: "Byte suggestion" }).boundingBox();
  expect(card!.x).toBeGreaterThanOrEqual(0); expect(card!.x + card!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/byte-mobile.png" });
  await page.getByRole("button", { name: "Dismiss Byte suggestion" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Byte suggestion" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Byte hints" }).uncheck();
  await page.goto("/editor");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Code browser").selectOption("");
  await expect(page.getByRole("checkbox", { name: "Byte hints" })).not.toBeChecked();
});

test("Blocks load and root movement are quiet; changed text supplies block context", async ({ page }) => {
  const requests: ByteRequest[] = [];
  await page.route("**/api/coach/review/", async (route) => {
    const body = route.request().postDataJSON() as ByteRequest; requests.push(body);
    await route.fulfill({ json: { revision: body.revision, suggestion: null } });
  });
  await open(page);
  await page.waitForTimeout(5500); expect(requests).toHaveLength(0);
  const roots = page.locator("svg.blocklySvg .blocklyBlockCanvas > .blocklyDraggable");
  const bounds = await roots.first().locator(":scope > .blocklyPath").boundingBox();
  await page.mouse.move(bounds!.x + 25, bounds!.y + 18); await page.mouse.down();
  await page.mouse.move(bounds!.x + 90, bounds!.y + 35, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(5500); expect(requests).toHaveLength(0);
  await page.locator("svg.blocklySvg .blocklyText").filter({ hasText: "Hello, world!" }).click();
  await page.locator(".blocklyHtmlInput").fill("Hello, Byte!");
  await page.locator(".blocklyHtmlInput").press("Enter");
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(1);
  expect(requests[0].snapshot.language).toBe("blocks");
  expect(requests[0].snapshot.python).toContain("Hello, Byte!");
  expect(requests[0].snapshot.blocks.some((block) => block.label.includes("Hello, Byte!"))).toBe(true);
  expect(Object.keys(requests[0].snapshot.sourceMap).length).toBeGreaterThan(0);
});

test("late response is discarded after editing and disabling stops future requests", async ({ page }) => {
  let body: ByteRequest | undefined;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/coach/review/", async (route) => {
    body = route.request().postDataJSON(); await gate;
    await route.fulfill({ json: { revision: body!.revision, suggestion: { category: "bug", message: "Old advice", issueKey: "old-advice", line: 1, blockId: null } } }).catch(() => {});
  });
  await open(page); await python(page);
  await page.locator(".cm-content").fill("print('first')");
  await expect.poll(() => !!body, { timeout: 15_000 }).toBe(true);
  await page.locator(".cm-content").fill("print('second')");
  release();
  await page.getByRole("checkbox", { name: "Byte hints" }).uncheck();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("region", { name: "Byte suggestion" })).toHaveCount(0);
});
