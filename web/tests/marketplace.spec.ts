import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { games } from "../src/components/marketplace/catalog";

test("marketplace filtering, links and responsive visual review", async ({
  page,
}) => {
  const errors: string[] = [];
  const runtimeRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/runtime/"))
      runtimeRequests.push(request.url());
  });
  await page.goto("/games?source=demos");
  await expect(
    page.getByRole("heading", { name: "Pick a world. Press play." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Play / })).toHaveCount(6);
  await page.getByRole("button", { name: "Platformer", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Play / })).toHaveCount(2);
  await page.getByRole("searchbox").fill("moon");
  await expect(page.getByRole("link", { name: /^Play / })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("moon");
  await page.getByRole("searchbox").fill("no such world");
  await expect(
    page.getByRole("heading", { name: "No worlds found. Yet!" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all games" }).click();
  await expect(page.getByRole("link", { name: /^Play / })).toHaveCount(6);
  await page.getByLabel("Sort games").selectOption("newest");
  await expect(
    page.getByRole("link", { name: /^Play / }).first(),
  ).toHaveAttribute("href", "/games/garden-quest");
  await page.getByLabel("Sort games").selectOption("featured");
  await mkdir("design/marketplace", { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1440, 1100],
    ["tablet", 820, 1180],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(900);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `design/marketplace/${name}-preview.png`,
      fullPage: true,
    });
  }
  expect(runtimeRequests).toEqual([]);
  expect(errors).toEqual([]);
});

async function observePosition(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    const positions = new Set<number>();
    const observed = window as unknown as {
      gamePosition?: { x: number; y: number; z: number };
      workersAlive: number;
    };
    observed.workersAlive = 0;
    window.Worker = class extends OriginalWorker {
      private ended = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        observed.workersAlive++;
        this.addEventListener("message", (event) => {
          const data = event.data;
          if (data.type === "request" && data.operation?.op === "position")
            positions.add(data.request);
        });
      }
      postMessage(message: Parameters<Worker["postMessage"]>[0]) {
        if (message.type === "response" && positions.delete(message.request))
          observed.gamePosition = message.result;
        super.postMessage(message);
      }
      terminate() {
        if (!this.ended) observed.workersAlive--;
        this.ended = true;
        super.terminate();
      }
    };
  });
}
async function position(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          gamePosition: { x: number; y: number; z: number };
        }
      ).gamePosition,
  );
}
async function walkTo(page: Page, x: number, z: number) {
  for (const [axis, goal, positive, negative] of [
    ["x", x, "d", "a"],
    ["z", z, "w", "s"],
  ] as const) {
    const current = (await position(page))[axis];
    if (Math.abs(goal - current) < 0.35) continue;
    const sign = Math.sign(goal - current),
      key = sign > 0 ? positive : negative;
    await page.keyboard.down(key);
    try {
      await expect
        .poll(async () => sign * ((await position(page))[axis] - goal), {
          timeout: 12000,
          intervals: [80],
        })
        .toBeGreaterThan(-0.3);
    } finally {
      await page.keyboard.up(key);
    }
  }
}

for (const game of games)
  test(`${game.title}: actual gameplay, objective, restart and cleanup`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await observePosition(page);
    await page.goto(`/games/${game.slug}`);
    await page.getByRole("button", { name: "Play game", exact: true }).click();
    const shell = page.locator("[data-status]");
    await expect(shell).toHaveAttribute("data-status", "running");
    await expect(page.getByLabel("Game progress")).toContainText("0 /");
    await expect.poll(() => position(page)).toBeTruthy();
    await mkdir("public/games/screenshots", { recursive: true });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(shell).toHaveAttribute("data-status", "paused");
    await page
      .locator("canvas")
      .screenshot({ path: `public/games/screenshots/${game.slug}.png` });
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    const data = JSON.parse(
      await readFile(`public/games/data/${game.slug}.json`, "utf8"),
    );
    const goals = data.project.entities.filter((e: { id: string }) =>
      e.id.startsWith("goal-"),
    );
    if (game.category === "Platformer") {
      const gap = game.slug === "moon-bounce" ? 7 : 5;
      for (let i = 0; i < goals.length; i++) {
        await walkTo(page, 0, i * gap);
        await page.waitForTimeout(350);
        await page.keyboard.press("Space");
        await expect.poll(async () => (await position(page)).y, { intervals: [50] }).toBeGreaterThan(1.45);
        await page.keyboard.down("w");
        await expect
          .poll(async () => (await position(page)).z, {
            intervals: [70],
            timeout: 15000,
          })
          .toBeGreaterThan((i + 1) * gap - 0.4);
        await page.keyboard.up("w");
        await expect(page.getByLabel("Game progress")).toContainText(
          `${i + 1} /`,
        );
        await expect
          .poll(async () => (await position(page)).y, { intervals: [100] })
          .toBeLessThan(1.2);
        await page.waitForTimeout(300);
      }
    } else if (game.category === "Puzzle") {
      for (const [x, z] of [
        [-6, 1],
        [-6, 5],
        [-5, 5],
        [6, 5],
        [6, 10],
        [5, 10],
        [-6, 10],
        [-6, 16],
        [0, 16],
      ])
        await walkTo(page, x, z);
    } else if (game.category === "Racing") {
      for (const goal of goals) {
        // Worker position samples can lag key releases. Center between the posts
        // in short steps, and clear each gate before moving sideways again.
        for (let step = 0; step < 40; step++) {
          const delta = goal.transform.position.x - (await position(page)).x;
          if (Math.abs(delta) < 0.7) break;
          const key = delta > 0 ? "d" : "a";
          await page.keyboard.down(key);
          await page.waitForTimeout(75);
          await page.keyboard.up(key);
          await page.waitForTimeout(200);
        }
        expect(Math.abs(goal.transform.position.x - (await position(page)).x)).toBeLessThan(0.7);
        await walkTo(page, (await position(page)).x, goal.transform.position.z + 1.5);
      }
    } else
      for (const goal of goals)
        await walkTo(
          page,
          goal.transform.position.x,
          goal.transform.position.z,
        );
    await expect(page.getByLabel("Game progress")).toContainText("Complete!");
    if (game.slug === "woodland-wander") {
      await page
        .getByRole("button", { name: "Fullscreen", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => !!document.fullscreenElement))
        .toBe(true);
      await page.getByRole("button", { name: "Exit fullscreen" }).click();
      await page.screenshot({
        path: "design/marketplace/game-preview.png",
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: "Restart", exact: true }).click();
    await expect(page.getByLabel("Game progress")).toContainText(
      `0 / ${goals.length}`,
    );
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(shell).toHaveAttribute("data-status", "ready");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { workersAlive: number }).workersAlive,
        ),
      )
      .toBe(0);
    await page.getByRole("button", { name: "Play game", exact: true }).click();
    await expect(shell).toHaveAttribute("data-status", "running");
    await page.getByRole("link", { name: "Back to exploring" }).click();
    await expect(
      page.getByRole("heading", { name: "Pick a world. Press play." }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { workersAlive: number }).workersAlive,
        ),
      )
      .toBe(0);
    expect(errors).toEqual([]);
  });

test("catalog editor handoff, local export and failed load recovery", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/games/woodland-wander");
  await page.getByRole("link", { name: "Open in editor" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Woodland Wander");
  await expect(page.getByRole("status").filter({ hasText: "Ready to make your own" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Project name").fill("My woodland remix");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const downloaded = await pending;
  const exported = JSON.parse(
    await readFile((await downloaded.path())!, "utf8"),
  );
  const original = JSON.parse(
    await readFile("public/games/data/woodland-wander.json", "utf8"),
  );
  expect(exported.project.name).toBe("My woodland remix");
  expect(exported.script).toEqual(original.script);
  expect(original.project.name).toBe("Woodland Wander");
  expect(
    exported.project.assets.every((a: { url: string }) =>
      a.url.startsWith("data:"),
    ),
  ).toBe(true);
  await page.route("**/games/data/cloud-hop.json", (route) =>
    route.fulfill({ status: 500, body: "Failed" }),
  );
  await page.goto("/games/cloud-hop");
  await expect(page.locator("[data-status]").getByRole("alert")).toContainText(
    "could not be downloaded",
  );
  await page.unroute("**/games/data/cloud-hop.json");
  await page.getByRole("button", { name: "Reload game" }).click();
  await expect(
    page.getByRole("button", { name: "Play game", exact: true }),
  ).toBeVisible();
  await page.goto("/games/missing-world");
  await expect(
    page.getByRole("heading", { name: "This world is still undiscovered." }),
  ).toBeVisible();
});
