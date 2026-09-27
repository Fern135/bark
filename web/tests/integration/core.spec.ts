import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

function identity() { const tag = randomUUID().slice(0, 12); return { username: `creator-${tag}`, email: `${tag}@example.test`, password: `Bark-${randomUUID()}!` }; }
async function post(context: BrowserContext, path: string, data: unknown) {
  await context.request.get("/api/auth/csrf/");
  const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrftoken")!.value;
  return context.request.post(`/api${path}`, { data, headers: { "X-CSRFToken": csrf } });
}
async function account(context: BrowserContext) {
  const user = identity();
  // Gateway auth requests have a per-IP budget. Account setup honors its retry window.
  for (const [path, data] of [["/auth/register/", user], ["/auth/login/", user]] as const) {
    let response = await post(context, path, data);
    for (let i = 0; response.status() === 429 && i < 5; i++) { await new Promise((resolve) => setTimeout(resolve, 6500)); response = await post(context, path, data); }
    expect(response.ok()).toBeTruthy();
  }
  return user;
}
async function open(page: Page, path = "/editor") {
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
}
async function saved(page: Page) { await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 45_000 }); }
async function records(context: BrowserContext) { return (await (await context.request.get("/api/canvas/games/")).json()).games as { id: string; name: string; revision: number }[]; }

test("guest draft becomes a real account game, survives reopening, plays, renames and deletes", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  let prompt = ""; page.on("dialog", (dialog) => dialog.accept(prompt));
  await open(page);
  await context.setOffline(true); await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Sign in to save", exact: true })).toBeVisible();
  await page.getByLabel("Project name").fill("  Guest adventure  ");
  await page.getByRole("button", { name: "Sign in to save", exact: true }).click();
  await page.getByRole("link", { name: "Sign up", exact: true }).click();
  const user = identity();
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("  Guest adventure  ");
  await saved(page);
  const [game] = await records(context);
  expect(game.name).toBe("Guest adventure");
  const detail = await (await context.request.get(`/api/canvas/games/${game.id}/`)).json();
  expect(detail.document.project.assets.every((asset: { url: string }) => asset.url.startsWith("data:"))).toBeTruthy();
  expect(detail.document.script.language).toBe("blocks");
  const cookie = (await context.cookies()).find((cookie) => cookie.name === "access_token");
  expect(cookie?.httpOnly).toBeTruthy();
  await page.getByRole("link", { name: "My Games", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Guest adventure" })).toBeVisible();
  await page.screenshot({ path: ".cache/my-games-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".cache/my-games-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Guest adventure");
  await page.reload(); await saved(page);
  await page.getByRole("link", { name: "My Games", exact: true }).click();
  await page.getByRole("link", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Play game", exact: true }).click();
  await expect(page.locator("[data-status]")).toHaveAttribute("data-status", "running");
  const me = page.waitForResponse((response) => response.url().endsWith("/api/auth/me/"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await me;
  await expect(page.locator("[data-status]")).toHaveAttribute("data-status", "running");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("link", { name: /My Games/ }).first().click();
  prompt = "Renamed adventure";
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("heading", { name: prompt })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A world of possibilities" })).toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Log in", exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("autosave coalesces in-flight changes, retries offline work, and detects two-tab conflicts", async ({ page, context }) => {
  await account(context); page.on("dialog", (dialog) => dialog.accept());
  await open(page); await saved(page);
  const [game] = await records(context);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let captured = false;
  await page.route(`**/api/canvas/games/${game.id}/`, async (route) => {
    if (route.request().method() === "PUT" && !captured) { captured = true; await held; }
    await route.continue();
  });
  await page.getByLabel("Project name").fill("First edit");
  await expect.poll(() => captured).toBe(true);
  await page.getByLabel("Project name").fill("Newest edit");
  release(); await saved(page);
  expect((await records(context))[0].name).toBe("Newest edit");
  await page.unroute(`**/api/canvas/games/${game.id}/`);
  await context.setOffline(true);
  await page.getByLabel("Project name").fill("Offline edit");
  await expect(page.getByRole("status").filter({ hasText: /Offline/ })).toBeVisible();
  await context.setOffline(false); await saved(page);
  expect((await records(context))[0].name).toBe("Offline edit");
  const second = await context.newPage(); second.on("dialog", (dialog) => dialog.accept());
  await open(second, `/editor?id=${game.id}`); await saved(second);
  await page.getByLabel("Project name").fill("First tab wins"); await saved(page);
  await second.getByLabel("Project name").fill("Second tab copy");
  await expect(second.getByRole("button", { name: "Save as a copy" })).toBeVisible();
  expect((await records(context))[0].name).toBe("First tab wins");
  await second.getByRole("button", { name: "Save as a copy" }).click(); await saved(second);
  expect((await records(context)).map((entry) => entry.name).sort()).toEqual(["First tab wins", "Second tab copy"]);
  await second.close();
});

test("session expiry keeps edits through login and imported Python remains playable", async ({ page, context }) => {
  const user = await account(context); page.on("dialog", (dialog) => dialog.accept());
  await open(page); await saved(page);
  const [game] = await records(context);
  await post(context, "/auth/logout/", {});
  await page.getByLabel("Project name").fill("After session expiry");
  await expect(page.getByRole("button", { name: "Sign in to save" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in to save" }).click();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("After session expiry"); await saved(page);
  const detail = await (await context.request.get(`/api/canvas/games/${game.id}/`)).json();
  detail.document.script = { language: "python", source: "print('Imported Python works')\n", blocksBackup: detail.document.script.workspace };
  const imported = page.waitForResponse((response) => response.url().endsWith(`/api/canvas/games/${game.id}/`) && response.request().method() === "PUT" && response.ok());
  await page.getByLabel("Import game JSON").setInputFiles({ name: "python.bark.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(detail.document)) });
  await imported;
  await saved(page);
  await page.reload(); await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  const fresh = await (await context.request.get(`/api/canvas/games/${game.id}/`)).json();
  expect(fresh.document.script.language).toBe("python"); expect(fresh.document.script.blocksBackup).toBeTruthy();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect((await records(context))[0].revision).toBe(fresh.revision);
});

test("lost creation responses retry once without duplicating worlds, and validation failures retain edits", async ({ page, context }) => {
  await account(context); page.on("dialog", (dialog) => dialog.accept());
  let lost = false;
  await page.route("**/api/canvas/games/", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true; const response = await route.fetch(); expect(response.status()).toBe(201);
      await route.fulfill({ status: 503, json: { error: "Simulated lost response" } });
    } else await route.continue();
  });
  await open(page);
  await expect.poll(() => lost).toBe(true);
  await page.getByLabel("Project name").fill("Latest retry edit"); await saved(page);
  const games = await records(context); expect(games).toHaveLength(1); expect(games[0].name).toBe("Latest retry edit");
  let writes = 0;
  await page.route(`**/api/canvas/games/${games[0].id}/`, async (route) => {
    if (route.request().method() === "PUT") { writes++; await route.fulfill({ status: 400, json: { error: "Document cannot be saved" } }); }
    else await route.continue();
  });
  await page.getByLabel("Project name").fill("Keep this edit");
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  await page.waitForTimeout(2500); expect(writes).toBe(1);
  await expect(page.getByLabel("Project name")).toHaveValue("Keep this edit");
  await page.unroute(`**/api/canvas/games/${games[0].id}/`);
  await page.getByRole("button", { name: "Retry save" }).click(); await saved(page);
  expect((await records(context))[0].name).toBe("Keep this edit");
});

test("real recovery messages support username lookup and a one-use password reset", async ({ page, context }) => {
  const user = await account(context); await post(context, "/auth/logout/", {});
  await page.goto("/forgot-username");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByRole("button", { name: "Send instructions" }).click();
  await expect(page.getByLabel("Demo inbox")).toContainText(user.username);
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByRole("button", { name: "Send instructions" }).click();
  await page.getByRole("link", { name: "Choose a new password" }).first().click();
  const resetUrl = page.url();
  const password = `New-${randomUUID()}!`;
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toHaveText("Password updated");
  await page.getByRole("link", { name: "Back to login" }).click();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/my-games$/);
  await page.goto(resetUrl);
  await page.getByLabel("New password", { exact: true }).fill(`Other-${randomUUID()}!`);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("invalid or has expired");
});
