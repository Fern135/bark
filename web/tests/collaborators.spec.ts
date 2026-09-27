import { expect, test } from "@playwright/test";

test("guest editor hides sample collaborators and keeps account and playback controls responsive", async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Collaborators preview/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "My Games", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in to save", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["Pause", "Stop", "Restart", "Export JSON"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
});
