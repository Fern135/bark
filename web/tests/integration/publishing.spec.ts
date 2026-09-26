import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";

async function write(context: BrowserContext, method: "post" | "put", path: string, data: unknown, headers: Record<string, string> = {}) {
  await context.request.get("/api/auth/csrf/");
  const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrftoken")!.value;
  return context.request[method](`/api${path}`, { data, headers: { "X-CSRFToken": csrf, ...headers } });
}
async function account(context: BrowserContext) {
  const tag = randomUUID().slice(0, 10);
  const user = { username: `publisher-${tag}`, email: `${tag}@example.test`, password: `Bark-${randomUUID()}!` };
  expect((await write(context, "post", "/auth/register/", user)).ok()).toBeTruthy();
  expect((await write(context, "post", "/auth/login/", user)).ok()).toBeTruthy();
}

test("publish, anonymous discovery/play, live edits, sharing and unpublish", async ({ page, context, browser, baseURL }) => {
  test.setTimeout(180_000);
  await account(context);
  const name = `Public adventure ${randomUUID().slice(0, 8)}`;
  await page.goto("/editor?game=woodland-wander");
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your world is public!" })).toBeVisible();
  const href = await page.getByRole("link", { name: "View game" }).getAttribute("href");
  const id = href!.split("/").at(-1)!;
  await mkdir("design/publishing", { recursive: true });
  await page.screenshot({ path: "design/publishing/editor-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Published", exact: true })).toBeFocused();
  const visitor = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1050 } });
  const publicPage = await visitor.newPage();
  const errors: string[] = [];
  let workers = 0;
  publicPage.on("worker", (worker) => { workers++; worker.on("close", () => workers--); });
  publicPage.on("pageerror", (error) => errors.push(error.message));
  publicPage.on("console", (message) => { if (message.type() === "error") console.log("PLAYER:", message.text().slice(0, 600)); });
  try {
    await publicPage.goto(`/games?q=${encodeURIComponent(name)}`);
    await expect(publicPage.getByRole("link", { name: `Play ${name}` })).toBeVisible();
    await publicPage.screenshot({ path: "design/publishing/community-desktop.png", fullPage: true });
    await publicPage.getByRole("link", { name: `Play ${name}` }).click();
    const frame = publicPage.frameLocator("iframe");
    await expect(frame.getByRole("button", { name: "Play game", exact: true })).toBeVisible({ timeout: 60_000 });
    await frame.getByRole("button", { name: "Play game", exact: true }).click();
    await expect(frame.getByRole("status").filter({ hasText: /^running$/ })).toBeVisible({ timeout: 60_000 });
    await expect(frame.getByLabel("Game progress")).toContainText("Treasures");
    await frame.getByLabel(`${name} game canvas`).click();
    await publicPage.keyboard.down("w");
    await expect(frame.getByLabel("Game progress")).toContainText("1 / 5");
    await publicPage.keyboard.up("w");
    await frame.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
    await frame.getByRole("button", { name: "Resume", exact: true }).click();
    await frame.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await expect.poll(() => publicPage.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await frame.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await expect.poll(() => publicPage.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await frame.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Play game", exact: true })).toBeVisible();
    await expect.poll(() => workers).toBe(0);
    await frame.getByRole("button", { name: "Restart", exact: true }).click();
    await expect(frame.getByRole("status").filter({ hasText: /^running$/ })).toBeVisible();
    await expect(frame.getByText("Waking up your world…")).toHaveCount(0);
    await publicPage.waitForTimeout(300);
    await publicPage.screenshot({ path: "design/publishing/player-desktop.png", fullPage: true });
    for (const [device, width, height] of [["tablet", 820, 1180], ["mobile", 390, 844]] as const) {
      await publicPage.setViewportSize({ width, height });
      await expect.poll(() => publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await publicPage.waitForTimeout(300);
      expect(await frame.locator("body").evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      await publicPage.screenshot({ path: `design/publishing/player-${device}.png`, fullPage: true });
    }
    const renamed = `${name} updated`;
    await page.getByLabel("Project name").fill(renamed);
    await expect.poll(async () => (await (await visitor.request.get(`/api/marketplace/games/${id}/`)).json()).name).toBe(renamed);
    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Published", exact: true }).click();
    await page.getByRole("button", { name: "Unpublish", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your world is private" })).toBeVisible();
    expect((await visitor.request.get(`/api/marketplace/games/${id}/`)).status()).toBe(404);
    await publicPage.reload();
    await expect(publicPage.getByRole("heading", { name: "This world is still undiscovered." })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await visitor.close(); }
});

test("My Games publishes a Blocks game with cover fallback and keeps the success panel open", async ({ context, page }) => {
  await account(context);
  const document = JSON.parse(await readFile("public/games/data/woodland-wander.json", "utf8"));
  for (const asset of document.project.assets) if (asset.url.startsWith("/")) asset.url = `data:model/gltf-binary;base64,${(await readFile(`public${asset.url}`)).toString("base64")}`;
  const text = (TEXT: string) => ({ block: { type: "text", fields: { TEXT } } });
  document.script = { language: "blocks", workspace: { blocks: { languageVersion: 0, blocks: [{ type: "bark_start", inputs: { DO: { block: { type: "bark_hud", inputs: { KEY: text("hello"), LABEL: text("Blocks"), VALUE: text("Ready!") } } } } }] } } };
  const response = await write(context, "post", "/canvas/games/", { document });
  expect(response.ok()).toBeTruthy();
  const { id } = await response.json();
  await page.route("**/cover/", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503 }) : route.continue());
  await page.goto("/my-games");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your world is public!" })).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied!" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/games/${id}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "design/publishing/library-mobile.png", fullPage: true });
  await page.goto(`/games/${id}`);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "Play game", exact: true }).click();
  await expect(frame.getByLabel("Game progress")).toContainText("BlocksReady!", { timeout: 60_000 });
  await write(context, "put", `/marketplace/games/${id}/publication/`, { is_public: false });
});

test("publishing waits for saves and preserves failed work", async ({ context, page }) => {
  await account(context);
  let publications = 0;
  await page.route("**/api/marketplace/games/*/publication/", (route) => { publications++; return route.continue(); });
  await page.route("**/api/canvas/games/", (route) => route.request().method() === "POST" ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Test save rejected" }) }) : route.continue());
  await page.goto("/editor?game=woodland-wander");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save your changes before publishing" })).toBeVisible();
  expect(publications).toBe(0);
  await expect(page.getByLabel("Project name")).toHaveValue("Woodland Wander");
  await page.getByRole("button", { name: "Close publishing panel" }).click();
  await page.unroute("**/api/canvas/games/");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your world is public!" })).toBeVisible();
  expect(publications).toBe(1);
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
});

test("public Python cannot access account APIs or parent storage", async ({ context, page, baseURL }) => {
  await account(context);
  const document = JSON.parse(await readFile("public/games/data/woodland-wander.json", "utf8"));
  for (const asset of document.project.assets) {
    if (asset.url.startsWith("/")) asset.url = `data:model/gltf-binary;base64,${(await readFile(`public${asset.url}`)).toString("base64")}`;
  }
  document.script.source = `from bark import game
from js import fetch, globalThis
from pyodide.ffi import to_js

@game.on_start
async def check():
    blocked = 0
    try:
        globalThis.localStorage.getItem("bark-test-secret")
    except Exception:
        blocked += 1
    try:
        await fetch(${JSON.stringify(`${baseURL}/api/canvas/games/`)}, to_js({"credentials": "include"}, dict_converter=globalThis.Object.fromEntries))
    except Exception:
        blocked += 1
    await game.set_hud("isolation", "Blocked checks", str(blocked))
`;
  const saved = await write(context, "post", "/canvas/games/", { document });
  expect(saved.ok()).toBeTruthy();
  const { id } = await saved.json();
  expect((await write(context, "put", `/marketplace/games/${id}/publication/`, { is_public: true })).ok()).toBeTruthy();
  await page.goto(`/games/${id}`);
  await page.evaluate(() => localStorage.setItem("bark-test-secret", "private"));
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("button", { name: "Play game", exact: true })).toBeVisible({ timeout: 60_000 });
  const storage = await frame.locator("body").evaluate(() => {
    let parentBlocked = false, storageBlocked = false;
    try { void parent.document.cookie; } catch { parentBlocked = true; }
    try { void localStorage.length; } catch { storageBlocked = true; }
    return { parentBlocked, storageBlocked };
  });
  expect(storage).toEqual({ parentBlocked: true, storageBlocked: true });
  let privateRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/canvas/")) privateRequests++; });
  await frame.getByRole("button", { name: "Play game", exact: true }).click();
  await expect(frame.getByLabel("Game progress")).toContainText("Blocked checks2", { timeout: 60_000 });
  expect(privateRequests).toBe(0);
  await write(context, "put", `/marketplace/games/${id}/publication/`, { is_public: false });
});

test("guest Publish preserves the draft through sign-in and publishes an untouched world", async ({ context, page }) => {
  await page.goto("/editor");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("link", { name: "Sign up", exact: true }).click();
  const tag = randomUUID().slice(0, 10);
  await page.getByLabel("Username", { exact: true }).fill(`guest-${tag}`);
  await page.getByLabel("Email", { exact: true }).fill(`${tag}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(`Bark-${randomUUID()}!`);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByLabel("Project name")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your world is public!" })).toBeVisible();
  const href = await page.getByRole("link", { name: "View game" }).getAttribute("href");
  expect((await context.request.get(`/api/marketplace${href}/`)).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
});

test("offline and conflicting saves cannot publish; recovery publishes the new copy only", async ({ context, page }) => {
  await account(context);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/editor");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  const original = (await (await context.request.get("/api/canvas/games/")).json()).games[0];
  const other = await context.newPage();
  await other.goto(`/editor?id=${original.id}`);
  await expect(other.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByLabel("Project name").fill("The latest original");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await context.setOffline(true);
  await other.getByLabel("Project name").fill("My recovered copy");
  await other.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(other.getByRole("alert").filter({ hasText: "Save your changes before publishing" })).toBeVisible();
  await other.getByRole("button", { name: "Close publishing panel" }).click();
  await context.setOffline(false);
  await expect(other.getByRole("button", { name: "Save as a copy" })).toBeVisible();
  await other.getByRole("button", { name: "Save as a copy" }).click();
  await expect(other.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  const publish = other.getByRole("button", { name: "Publish", exact: true });
  await publish.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(other.getByRole("heading", { name: "Your world is public!" })).toBeVisible();
  const href = await other.getByRole("link", { name: "View game" }).getAttribute("href");
  expect(href).not.toContain(original.id);
  expect((await context.request.get(`/api/marketplace/games/${original.id}/`)).status()).toBe(404);
  expect((await (await context.request.get(`/api/marketplace${href}/`)).json()).name).toBe("My recovered copy");
  await other.getByRole("button", { name: "Unpublish", exact: true }).click();
  await other.close();
});

test("collaborators see publication status without visibility controls", async ({ context, browser, baseURL }) => {
  await account(context);
  const saved = await (await write(context, "post", "/canvas/games/", { name: "Shared public world" })).json();
  const invite = await write(context, "post", `/canvas/games/${saved.id}/workspace/`, {}, { "If-Match": `"${saved.revision}"` });
  expect(invite.ok()).toBeTruthy();
  await write(context, "put", `/marketplace/games/${saved.id}/publication/`, { is_public: true });
  const collaborator = await browser.newContext({ baseURL });
  try {
    await account(collaborator);
    expect((await write(collaborator, "post", "/canvas/workspaces/join/", { code: (await invite.json()).code })).ok()).toBeTruthy();
    const page = await collaborator.newPage();
    await page.goto("/my-games");
    await page.getByRole("button", { name: "Shared with me" }).click();
    await expect(page.getByRole("heading", { name: "Shared public world" })).toBeVisible();
    await expect(page.getByText("Public · Saved changes are public", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Publish|Published|Unpublish)$/ })).toHaveCount(0);
    expect((await write(collaborator, "put", `/marketplace/games/${saved.id}/publication/`, { is_public: false })).status()).toBe(404);
  } finally { await collaborator.close(); }
  await write(context, "put", `/marketplace/games/${saved.id}/publication/`, { is_public: false });
});
