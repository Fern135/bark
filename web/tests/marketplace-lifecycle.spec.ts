import { expect, test } from "@playwright/test";

test("keyboard navigation and player startup cancellation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/games?source=demos");
  await expect(page.getByRole("searchbox", { name: "Search games" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to games" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#games")).toBeFocused();

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/runtime/worker.js", async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto("/games/cloud-hop");
  await page.getByRole("button", { name: "Play game", exact: true }).click();
  await expect(page.locator("[data-status]")).toHaveAttribute("data-status", "preparing");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  release();
  await expect(page.locator("[data-status]")).toHaveAttribute("data-status", "ready");
  await expect(page.locator("[data-status]").getByRole("alert")).toHaveCount(0);
  await page.unroute("**/runtime/worker.js");
  await page.getByRole("button", { name: "Play game", exact: true }).click();
  await expect(page.locator("[data-status]")).toHaveAttribute("data-status", "running");
  await expect(page.locator("[data-status]").getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.screenshot({ path: "design/marketplace/game-mobile-preview.png", fullPage: true });
  await page.getByRole("link", { name: "Back to exploring" }).click();
  await expect(page.getByRole("searchbox", { name: "Search games" })).toBeVisible();
  expect(errors).toEqual([]);
});
