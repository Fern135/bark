import { expect, test } from "@playwright/test";

test("community loading failure is retryable and distinct from an empty collection", async ({ page }) => {
  let fail = true;
  await page.route("**/api/marketplace/games/?**", (route) => route.fulfill({ status: fail ? 503 : 200, contentType: "application/json", body: JSON.stringify(fail ? { error: "Unavailable" } : { games: [], count: 0, page: 1, has_more: false }) }));
  await page.goto("/games");
  await expect(page.getByRole("alert").filter({ hasText: "couldn’t load community games" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your world could be the first." })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your world could be the first." })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole("searchbox", { name: "Search community games" }).evaluate((input) => input.parentElement!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.getByRole("searchbox", { name: "Search community games" }).fill("nothing");
  await expect(page).toHaveURL(/q=nothing/);
  await expect(page.getByRole("heading", { name: "No worlds found. Yet!" })).toBeVisible();
  await page.getByRole("link", { name: "Bark demos", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Play / })).toHaveCount(6);
});
