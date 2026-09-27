import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

async function post(context: BrowserContext, path: string, data: unknown, headers = {}) {
  await context.request.get("/api/auth/csrf/");
  const csrf = (await context.cookies()).find((c) => c.name === "csrftoken")!.value;
  return context.request.post(`/api${path}`, { data, headers: { "X-CSRFToken": csrf, ...headers } });
}
async function account(context: BrowserContext) {
  const data = { username: `code-${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@example.test`, password: `Local-Code!${randomUUID()}` };
  for (const path of ["/auth/register/", "/auth/login/"]) {
    const response = await post(context, path, data);
    expect(response.ok(), await response.text()).toBeTruthy();
  }
}
async function append(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(text);
}

async function connectWire(page: Page, id: string) {
  await page.evaluate((id) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/`);
    (window as unknown as { __codeWire: WebSocket }).__codeWire = socket;
    const timeout = setTimeout(() => reject(new Error("Workspace join timed out")), 15000);
    socket.addEventListener("message", ({ data }) => {
      const frame = JSON.parse(data);
      if (frame.type === "ready") socket.send(JSON.stringify({ type: "join", protocol: 3, doc: id }));
      if (frame.type === "joined") { clearTimeout(timeout); resolve(); }
    });
  }), id);
}
async function wire(page: Page, message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return page.evaluate((message) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket: WebSocket = (window as unknown as { __codeWire: WebSocket }).__codeWire;
    const timeout = setTimeout(() => { socket.removeEventListener("message", receive); reject(new Error("Workspace response timed out")); }, 15000);
    function receive({ data }: MessageEvent) {
      const frame = JSON.parse(data);
      if (frame.type === "error" || (message.type === "lock" && frame.type === "locked" && frame.nonce === message.nonce) || (message.type === "commit" && frame.type === "ack" && frame.commitId === message.commitId)) {
        clearTimeout(timeout); socket.removeEventListener("message", receive); resolve(frame);
      }
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify(message));
  }), message);
}
async function unlock(page: Page) {
  await page.evaluate(() => (window as unknown as { __codeWire: WebSocket }).__codeWire.send(JSON.stringify({ type: "unlock" })));
}

test("different object writers remain independent and same-object writers converge", async ({ page, context, browser }) => {
  await account(context);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await account(other);
  const peer = await other.newPage();
  try {
    const document = JSON.parse(await readFile("../example.json", "utf8"));
    const template = structuredClone(document.project.entities[0]);
    document.project.entities.push(...["player", "second"].map((id) => ({ ...structuredClone(template), id, name: id, tags: [], collider: null, body: null })));
    document.version = 2;
    document.script = { language: "python", source: "# global\n" };
    document.objectScripts = { player: { language: "python", source: "# player\n" }, second: { language: "python", source: "# second\n" } };
    const created = await post(context, "/canvas/games/", { document });
    expect(created.ok(), await created.text()).toBeTruthy();
    const game = await created.json();
    const workspace = await (await post(context, `/canvas/games/${game.id}/workspace/`, {}, { "If-Match": `"${game.revision}"` })).json();
    expect((await post(other, "/canvas/workspaces/join/", { code: workspace.code })).ok()).toBe(true);
    await Promise.all([page.goto(`/editor?id=${game.id}`), peer.goto(`/editor?id=${game.id}`)]);
    for (const p of [page, peer]) {
      await expect(p.getByRole("status").filter({ hasText: "Live · Saved" })).toBeVisible();
      await p.getByRole("button", { name: "Code", exact: true }).click();
    }
    await peer.getByLabel("Code browser").selectOption("second");
    await Promise.all([append(page, "# OWNER\n"), append(peer, "# PEER\n")]);
    const saved = async () => (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document;
    await expect.poll(async () => (await saved()).objectScripts.player.source).toContain("OWNER");
    await expect.poll(async () => (await saved()).objectScripts.second.source).toContain("PEER");
    expect((await saved()).script.source).toBe("# global\n");
    await peer.getByLabel("Code browser").selectOption("player");
    await expect(peer.locator(".cm-content")).toContainText("OWNER");
    for (let i = 0; i < 3; i++) {
      await Promise.all([append(page, `# LEFT${i}\n`), append(peer, `# RIGHT${i}\n`)]);
      for (const p of [page, peer]) {
        await expect(p.locator(".cm-content")).toContainText(`LEFT${i}`);
        await expect(p.locator(".cm-content")).toContainText(`RIGHT${i}`);
      }
    }
    await expect.poll(async () => (await saved()).objectScripts.player.source).toContain("RIGHT2");
    await Promise.all([connectWire(page, game.id), connectWire(peer, game.id)]);
    const resource = "object:player:script";
    expect((await wire(page, { type: "lock", resources: [resource], nonce: 1 })).type).toBe("locked");
    let state = await (await context.request.get(`/api/canvas/games/${game.id}/`)).json();
    const blocks = { language: "blocks", workspace: { blocks: { languageVersion: 0, blocks: [{ type: "bark_start", id: "owned-root", x: 40, y: 40 }] } } };
    expect((await wire(page, { type: "commit", commitId: randomUUID(), base: state.revision, ops: [{ op: "set", resource, before: state.document.objectScripts.player, value: blocks }] })).type).toBe("ack");
    await unlock(page);
    await expect(peer.locator(".block-editor > .injectionDiv > .blocklySvg")).toBeVisible();
    await page.mouse.move(0, 0); await peer.mouse.move(0, 0);
    await expect.poll(async () => await wire(page, { type: "lock", resources: ["object:player:block:owned-root"], nonce: 2 })).toMatchObject({ type: "locked" });
    const blocked = await wire(peer, { type: "lock", resources: ["object:player:block:owned-root"], nonce: 3 });
    expect(blocked.code).toBe("LOCK_HELD");
    await peer.getByLabel("Code browser").selectOption("second");
    await append(peer, "# UNRELATED_BLOCK_LOCK\n");
    await expect.poll(async () => (await saved()).objectScripts.second.source).toContain("UNRELATED_BLOCK_LOCK");
    await peer.getByLabel("Code browser").selectOption("player");
    await unlock(page);
    // Deleting the selected owner and its script is one durable edit batch.
    await expect.poll(async () => (await wire(page, { type: "lock", resources: ["*"], nonce: 4 })).type).toBe("locked");
    state = await (await context.request.get(`/api/canvas/games/${game.id}/`)).json();
    expect((await wire(page, { type: "commit", commitId: randomUUID(), base: state.revision, ops: [
      { op: "set", resource: "entity:player", before: state.document.project.entities.find((e: { id: string }) => e.id === "player"), value: null },
      { op: "set", resource, before: state.document.objectScripts.player, value: null },
    ] })).type).toBe("ack");
    await unlock(page);
    await expect(peer.getByLabel("Code browser")).toHaveValue("");
    await expect(peer.locator(".cm-content")).toContainText("# global");
    expect((await saved()).objectScripts.player).toBeUndefined();
    await page.screenshot({ path: ".cache/object-code-collaboration.png" });
  } finally { await other.close(); }
});
