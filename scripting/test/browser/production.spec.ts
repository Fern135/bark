import { test, expect } from "@playwright/test";
test("production playground serves local WASM, worker, blocks, Python, and save files", async ({
  page,
}) => {
  const badRequests: string[] = [],
    pageErrors: string[] = [],
    runtimeAssets: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) badRequests.push(response.url());
    if (response.url().includes("/pyodide/")) runtimeAssets.push(response.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prepare Python", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Prepare Python", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 45_000 });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect(page.getByTestId("console")).toContainText("Collect the three gems");
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await page.getByRole("button", { name: "Convert to Python →" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export game ↗" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.locator('input[type="file"]').setInputFiles(path!);
  await expect(page.getByRole("button", { name: "Restore saved blocks" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare Python", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 45_000 });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect(page.getByTestId("console")).toContainText("Collect the three gems");
  expect(runtimeAssets.some((url) => url.endsWith("pyodide.asm.wasm"))).toBe(true);
  expect(runtimeAssets.every((url) => url.startsWith("http://127.0.0.1:4174/"))).toBe(true);
  expect(badRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: "test-results/production-playground.png" });
});
