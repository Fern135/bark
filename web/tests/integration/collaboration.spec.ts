import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

async function post(context: BrowserContext, path: string, data: unknown, headers = {}) {
  await context.request.get("/api/auth/csrf/");
  const csrf = (await context.cookies()).find((c) => c.name === "csrftoken")!.value;
  return context.request.post(`/api${path}`, { data, headers: { "X-CSRFToken": csrf, ...headers } });
}
async function account(context: BrowserContext) {
  const user = { username: `team-${randomUUID().slice(0, 8)}`, email: `${randomUUID()}@example.test`, password: `Ink!Mountain?94-${randomUUID().slice(0, 8)}` };
  for (const path of ["/auth/register/", "/auth/login/"]) {
    let response = await post(context, path, user);
    for (let n = 0; response.status() === 429 && n < 8; n++) { await new Promise((r) => setTimeout(r, 6500)); response = await post(context, path, user); }
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  return user;
}

test("simultaneous Python writers converge, retain local undo and share moving cameras", async ({ page, context, browser }) => {
  const owner = await account(context);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const member = await account(other), peer = await other.newPage();
  const errors: string[] = [];
  for (const p of [page, peer]) { p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept()); }
  const document = JSON.parse(await readFile("../example.json", "utf8"));
  document.project.entities.push({ ...structuredClone(document.project.entities[0]), id: "player", name: "Cube", tags: [], transform: { position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, visual: { kind: "box", size: { x: 1, y: 1, z: 1 }, color: "#ee9944" }, collider: null, body: null });
  document.script = { language: "python", source: "# shared world\n" };
  const created = await post(context, "/canvas/games/", { document });
  expect(created.ok(), await created.text()).toBeTruthy();
  const game = await created.json();
  const workspace = await (await post(context, `/canvas/games/${game.id}/workspace/`, {}, { "If-Match": `"${game.revision}"` })).json();
  expect((await post(other, "/canvas/workspaces/join/", { code: workspace.code })).ok()).toBe(true);
  let receivedCamera: unknown;
  let receivedPreview: { id: string; transform: { position: { x: number } } } | null = null;
  let ownerLease = false;
  peer.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
    if (!socket.url().endsWith("/ws/")) return;
    const frame = JSON.parse(String(payload));
    if (frame.type === "presence") {
      const ownerPeer = frame.peers.find((p: { user: string }) => p.user === game.owner.user);
      receivedCamera = ownerPeer?.camera; receivedPreview = ownerPeer?.preview ?? null;
    }
    if (frame.locks) ownerLease = frame.locks.some((l: { user: string; resource: string }) => l.user === game.owner.user && l.resource === "entity:player");
  }));
  await Promise.all([page.goto(`/editor?id=${game.id}`), peer.goto(`/editor?id=${game.id}`)]);
  for (const p of [page, peer]) await expect(p.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible();
  await expect(page.getByLabel("Collaborator cameras")).toContainText(member.username);
  await expect(peer.getByLabel("Collaborator cameras")).toContainText(owner.username);
  await expect.poll(() => receivedCamera).toBeTruthy();
  await page.getByRole("button", { name: /^Cube(?: Cube)?$/ }).click();
  await page.getByRole("button", { name: "Transform settings", exact: true }).click();
  await page.getByLabel("Snap to increments").uncheck();
  await page.keyboard.press("Escape");
  const worldCanvas = page.getByLabel("Interactive 3D world", { exact: true });
  await worldCanvas.focus(); await page.keyboard.press("f");
  const bounds = (await worldCanvas.boundingBox())!, factor = bounds.height / 589;
  const handle = { x: bounds.x + bounds.width / 2 + 60.5 * factor, y: bounds.y + bounds.height / 2 + 1.5 * factor };
  await page.mouse.move(handle.x, handle.y);
  await expect.poll(() => ownerLease).toBe(true);
  await page.mouse.down(); await page.mouse.move(handle.x + 90 * factor, handle.y + 9 * factor, { steps: 20 });
  await expect.poll(() => receivedPreview?.transform.position.x).toBeGreaterThan(0);
  const during = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document;
  expect(during.project.entities.find((e: { id: string }) => e.id === "player").transform.position.x).toBe(0);
  await peer.screenshot({ path: ".cache/realtime-drag.png" });
  await page.mouse.up();
  await expect.poll(async () => (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document.project.entities.find((e: { id: string }) => e.id === "player").transform.position.x).toBeGreaterThan(0);
  await expect.poll(() => receivedPreview).toBeNull();
  await page.bringToFront();
  const beforeCamera = JSON.stringify(receivedCamera);
  const canvas = page.getByLabel("Interactive 3D world", { exact: true });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await expect.poll(() => JSON.stringify(receivedCamera)).not.toBe(beforeCamera);
  await peer.screenshot({ path: ".cache/realtime-cameras.png" });
  for (const p of [page, peer]) {
    await p.getByRole("button", { name: "Code", exact: true }).click();
    await p.getByLabel("Code browser").selectOption("");
    await expect(p.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
    await p.locator(".cm-content").click();
    await p.keyboard.press("Control+End");
  }
  for (let round = 0; round < 4; round++) {
    await Promise.all([page.keyboard.insertText(`# OWNER${round}\n`), peer.keyboard.insertText(`# PEER${round}\n`)]);
    for (const p of [page, peer]) {
      await expect(p.locator(".cm-content")).toContainText(`OWNER${round}`);
      await expect(p.locator(".cm-content")).toContainText(`PEER${round}`);
      await expect(p.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible();
    }
  }
  const saved = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document;
  for (let round = 0; round < 4; round++) for (const author of ["OWNER", "PEER"]) expect(saved.script.source.match(new RegExp(`${author}${round}`, "g"))).toHaveLength(1);
  for (const p of [page, peer]) {
    const download = p.waitForEvent("download");
    await p.getByRole("button", { name: "Export JSON", exact: true }).click();
    expect(JSON.parse(await readFile((await (await download).path())!, "utf8"))).toEqual(saved);
  }
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("# UNDO_ME\n");
  await expect(peer.locator(".cm-content")).toContainText("UNDO_ME");
  await peer.locator(".cm-content").click(); await peer.keyboard.press("Control+End");
  await peer.keyboard.insertText("# KEEP_PEER\n");
  await expect(page.locator(".cm-content")).toContainText("KEEP_PEER");
  await page.keyboard.press("Control+z");
  for (const p of [page, peer]) {
    await expect(p.locator(".cm-content")).not.toContainText("UNDO_ME");
    await expect(p.locator(".cm-content")).toContainText("KEEP_PEER");
  }
  await peer.reload();
  await peer.getByRole("button", { name: "Code", exact: true }).click();
  await peer.getByLabel("Code browser").selectOption("");
  await expect(peer.locator(".cm-content")).toContainText("KEEP_PEER");
  await other.close();
  await page.getByRole("button", { name: "Viewport", exact: true }).click();
  await expect(page.getByLabel("Collaborator cameras")).toBeEmpty();
  expect(errors).toEqual([]);
});

test("invite-only workspace, live edits, ownership, presence and persistent shared library", async ({ page, context, browser }) => {
  const owner = await account(context);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const editor = await account(other); const peer = await other.newPage();
  const leases = new Map<typeof page, { conn: string; locks: { conn: string; resource: string }[] }>();
  for (const client of [page, peer]) {
    leases.set(client, { conn: "", locks: [] });
    client.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
      if (!socket.url().endsWith("/ws/")) return;
      const frame = JSON.parse(String(payload)); const state = leases.get(client)!;
      if (frame.type === "ready") state.conn = frame.conn;
      if (frame.locks) state.locks = frame.locks;
    }));
  }
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message)); peer.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept()); peer.on("dialog", (d) => d.accept());
  await page.goto("/editor");
  await expect(page.getByRole("status", { includeHidden: true }).filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 45000 });
  const records = await (await context.request.get("/api/canvas/games/")).json();
  const game = records.games[0];
  expect((await other.request.get(`/api/canvas/games/${game.id}/`)).status()).toBe(404);
  await page.getByRole("button", { name: "Collaborators", exact: true }).click();
  await page.getByRole("button", { name: "Invite collaborators", exact: true }).click();
  await expect(page.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible();
  if (!(await page.getByRole("dialog").isVisible())) { await page.getByRole("button", { name: "Collaborators", exact: true }).click(); await page.getByRole("button", { name: "Invite collaborators", exact: true }).click(); }
  const code = await page.getByLabel("Invite code", { exact: true }).inputValue();
  await page.screenshot({ path: ".cache/collaboration-invite.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeInViewport();
  await page.screenshot({ path: ".cache/collaboration-invite-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Close invite" }).click();
  await peer.goto(`/join?code=${encodeURIComponent(code)}`);
  await peer.getByRole("button", { name: "Join workspace", exact: true }).click();
  await expect(peer.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible();
  await expect(peer.getByLabel("Project name")).toBeDisabled();
  await page.getByLabel("Project name").fill("Our live world");
  await expect(peer.getByLabel("Project name")).toHaveValue("Our live world", { timeout: 5000 });
  await page.getByRole("button", { name: "Crate", exact: true }).click();
  await peer.getByRole("button", { name: "Rock", exact: true }).click();
  await Promise.all([page.getByLabel("Name", { exact: true }).fill("Team crate"), peer.getByLabel("Name", { exact: true }).fill("Team rock")]);
  await expect(peer.getByRole("button", { name: "Team crate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Team rock", exact: true })).toBeVisible();
  for (const p of [page, peer]) {
    await p.getByRole("button", { name: "Code", exact: true }).click();
    await p.getByLabel("Code browser").selectOption("");
  }
  const rootSelector = "svg.blocklySvg .blocklyBlockCanvas > .blocklyDraggable";
  const originalRoots = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document.script.workspace.blocks.blocks;
  const moveRoot = async (p: typeof page, index: number) => {
    const root = p.locator(rootSelector).nth(index); const path = root.locator(":scope > .blocklyPath");
    await root.hover({ position: { x: 30, y: 28 } });
    await expect.poll(() => leases.get(p)!.locks.some((l) => l.conn === leases.get(p)!.conn && l.resource === `block:${originalRoots[index].id}`)).toBe(true);
    // Re-observe after Blockly's initial layout and the lease acknowledgment.
    await root.hover({ position: { x: 30, y: 28 } });
    const box = (await path.boundingBox())!;
    const hit = await p.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".blocklyDraggable")?.getAttribute("data-id"), { x: box.x + 30, y: box.y + 28 });
    expect(hit).toBe(originalRoots[index].id);
    await p.mouse.down(); await p.mouse.move(box.x + 85, box.y + 58, { steps: 10 }); await p.mouse.up();
  };
  await Promise.all([moveRoot(page, 0), moveRoot(peer, 1)]);
  await expect.poll(async () => {
    const roots = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document.script.workspace.blocks.blocks;
    return roots.filter((r: { id: string; x: number; y: number }) => { const before = originalRoots.find((b: { id: string }) => b.id === r.id); return before && (before.x !== r.x || before.y !== r.y); }).length;
  }).toBe(2);
  await expect.poll(() => leases.get(page)!.locks.length).toBe(0);
  await page.getByRole("button", { name: "Undo block edit", exact: true }).click();
  await expect.poll(async () => {
    const roots = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document.script.workspace.blocks.blocks;
    return roots.map((root: { x: number; y: number }, index: number) => root.x !== originalRoots[index].x || root.y !== originalRoots[index].y);
  }).toEqual([false, true]);
  await page.getByRole("button", { name: "Redo block edit", exact: true }).click();
  await expect.poll(async () => {
    const roots = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document.script.workspace.blocks.blocks;
    return roots.map((root: { x: number; y: number }, index: number) => root.x !== originalRoots[index].x || root.y !== originalRoots[index].y);
  }).toEqual([true, true]);
  const expectedDocument = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document;
  for (const client of [page, peer]) {
    await expect(client.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible();
    const downloading = client.waitForEvent("download");
    await client.getByRole("button", { name: "Export JSON", exact: true }).click();
    const download = await downloading;
    expect(JSON.parse(await readFile((await download.path())!, "utf8"))).toEqual(expectedDocument);
  }
  await peer.getByRole("button", { name: "Collaborators", exact: true }).click();
  await expect(peer.getByText(owner.username, { exact: true })).toBeVisible();
  await expect(peer.getByText(`${editor.username} (you)`, { exact: true })).toBeVisible();
  await peer.screenshot({ path: ".cache/collaboration-roster.png" });
  await peer.getByRole("button", { name: "Close collaborators" }).click();
  await peer.reload();
  await expect(peer.getByLabel("Project name")).toHaveValue("Our live world");
  await peer.getByRole("link", { name: "My Games", exact: true }).click();
  await peer.getByRole("button", { name: "Shared with me", exact: true }).click();
  await expect(peer.getByRole("heading", { name: "Our live world" })).toBeVisible();
  await expect(peer.getByRole("button", { name: "Leave", exact: true })).toBeVisible();
  await expect(peer.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await peer.getByRole("link", { name: "Play", exact: true }).click();
  await peer.getByRole("button", { name: "Play game", exact: true }).click();
  await expect(peer.locator("[data-status]:not([data-next-badge])")).toHaveAttribute("data-status", "running");
  expect(errors).toEqual([]); await other.close();
});

type Frame = { type: string; rev?: number; code?: string; commitId?: string; document?: { project: { properties: object; settings: object } } };
declare global { interface Window { testSocket: WebSocket; testFrames: Frame[] } }
async function socket(page: import("@playwright/test").Page, id: string) {
  await page.goto("/join");
  await page.evaluate((doc) => {
    window.testFrames = [];
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/`);
    window.testSocket = ws;
    ws.onmessage = (e) => { const m = JSON.parse(e.data); window.testFrames.push(m); if (m.type === "ready") ws.send(JSON.stringify({ type: "join", protocol: 3, doc })); };
  }, id);
  await expect.poll(() => page.evaluate(() => window.testFrames.some((f) => f.type === "joined"))).toBe(true);
}
async function send(page: import("@playwright/test").Page, frame: object) { await page.evaluate((f) => window.testSocket.send(JSON.stringify(f)), frame); }

test("real sockets serialize edits, deduplicate commits, enforce locks, replay and revoke membership", async ({ page, context, browser }) => {
  await account(context);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL }); await account(other);
  const peer = await other.newPage();
  const game = await (await post(context, "/canvas/games/", { name: "Socket workshop" })).json();
  const workspace = await (await post(context, `/canvas/games/${game.id}/workspace/`, {}, { "If-Match": `"${game.revision}"` })).json();
  expect((await post(other, "/canvas/workspaces/join/", { code: workspace.code })).ok()).toBe(true);
  await socket(page, game.id); await socket(peer, game.id);
  await send(page, { type: "lock", resources: ["section:properties"], nonce: 1 });
  await expect.poll(() => page.evaluate(() => window.testFrames.some((f) => f.type === "locked"))).toBe(true);
  await send(peer, { type: "lock", resources: ["section:properties"], nonce: 2 });
  await expect.poll(() => peer.evaluate(() => window.testFrames.some((f) => f.code === "LOCK_HELD"))).toBe(true);
  await send(peer, { type: "lock", resources: ["section:settings"], nonce: 3 });
  await expect.poll(() => peer.evaluate(() => window.testFrames.some((f) => f.type === "locked"))).toBe(true);
  const commit = { type: "commit", base: game.revision, commitId: randomUUID(), ops: [{ op: "set", resource: "section:properties", before: game.document.project.properties, value: { score: 7 } }] };
  const start = Date.now(); await send(page, commit);
  await expect.poll(() => peer.evaluate(() => window.testFrames.some((f) => f.type === "patch")), { intervals: [20, 50, 100], timeout: 5000 }).toBe(true);
  expect(Date.now() - start).toBeLessThan(1000);
  await send(page, commit);
  await expect.poll(() => page.evaluate(() => window.testFrames.filter((f) => f.type === "ack").length)).toBe(2);
  const saved = await (await context.request.get(`/api/canvas/games/${game.id}/`)).json();
  expect(saved.revision).toBe(game.revision + 1); expect(saved.document.project.properties).toEqual({ score: 7 });
  await send(peer, { ...commit, commitId: randomUUID() });
  await expect.poll(() => peer.evaluate(() => window.testFrames.some((f) => f.code === "REV_MISMATCH"))).toBe(true);
  await peer.evaluate(() => { window.testFrames = []; });
  await send(peer, { type: "join", protocol: 3, doc: game.id, have: game.revision });
  await expect.poll(() => peer.evaluate(() => window.testFrames.some((f) => f.type === "patch"))).toBe(true);
  const me = await (await other.request.get("/api/auth/me/")).json();
  const user = me.user?.user_id ?? me.user_id;
  await context.request.get("/api/auth/csrf/");
  const csrf = (await context.cookies()).find((c) => c.name === "csrftoken")!.value;
  expect((await context.request.delete(`/api/canvas/games/${game.id}/members/${user}/`, { headers: { "X-CSRFToken": csrf } })).ok()).toBe(true);
  await expect.poll(() => peer.evaluate(() => window.testSocket.readyState), { timeout: 10000 }).toBe(3);
  expect((await other.request.get(`/api/canvas/games/${game.id}/`)).status()).toBe(404);
  await other.close();
});

test("shared imports preserve Python, blocks and assets; offline editing pauses and reconnects", async ({ page, context, browser }) => {
  await account(context);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL }); await account(other);
  const peer = await other.newPage();
  page.on("dialog", (d) => d.accept()); peer.on("dialog", (d) => d.accept());
  await page.goto("/editor");
  await expect(page.getByRole("status", { includeHidden: true }).filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 45000 });
  const game = (await (await context.request.get("/api/canvas/games/")).json()).games[0];
  const workspace = await (await post(context, `/canvas/games/${game.id}/workspace/`, {}, { "If-Match": `"${game.revision}"` })).json();
  await post(other, "/canvas/workspaces/join/", { code: workspace.code });
  await page.reload(); await peer.goto(`/editor?id=${game.id}`);
  for (const p of [page, peer]) { await expect(p.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible(); await expect(p.getByRole("button", { name: "Play", exact: true })).toBeEnabled(); }
  const document = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document;
  const backup = document.script.workspace;
  document.script = { language: "python", source: 'print("shared import")\n', blocksBackup: backup };
  await page.getByLabel("Import game JSON").setInputFiles({ name: "shared.bark.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible();
  await peer.getByRole("button", { name: "Code", exact: true }).click();
  await peer.getByLabel("Code browser").selectOption("");
  await expect(peer.locator(".cm-content")).toContainText("shared import");
  const saved = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document;
  expect(saved.script.blocksBackup).toEqual(backup);
  expect(saved.project.assets.every((a: { url: string }) => a.url.startsWith("data:"))).toBe(true);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Code browser").selectOption("");
  await page.locator(".python-editor").hover();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("print('owner edit')\n");
  await expect(peer.locator(".cm-content")).toContainText("owner edit");
  await peer.locator(".python-editor").hover();
  await expect(peer.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await expect.poll(async () => { await peer.locator(".python-editor").click({ position: { x: 20, y: 20 } }); return peer.locator(".cm-content").getAttribute("contenteditable"); }).toBe("true");
  const authoredScript = (await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document.script;
  // Remote edits are excluded from this editor's local undo history.
  await peer.locator(".cm-content").click(); await peer.keyboard.press("Control+z");
  await expect(peer.locator(".cm-content")).toContainText("owner edit");
  await other.setOffline(true);
  await expect(peer.getByRole("alert").filter({ hasText: "Offline" })).toBeVisible();
  await expect(peer.getByRole("button", { name: "Export JSON", exact: true })).toBeEnabled();
  await page.getByLabel("Project name").fill("Updated while away");
  await expect(page.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible();
  await other.setOffline(false);
  await expect(peer.getByLabel("Project name")).toHaveValue("Updated while away");
  await peer.reload();
  await expect(peer.getByRole("status", { includeHidden: true }).filter({ hasText: "Live · Saved" })).toBeVisible();
  expect((await (await context.request.get(`/api/canvas/games/${game.id}/`)).json()).document.script).toEqual(authoredScript);
  await other.close();
});
