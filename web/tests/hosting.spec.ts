import { expect, test } from "@playwright/test";

const disabled = process.env.NEXT_PUBLIC_ACCOUNT_RECOVERY_ENABLED === "0";

test("frontend readiness responds without contacting the API", async ({ request }) => {
  const response = await request.get("/health/ready");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ status: "ok" });
});

test("recovery reflects the production build flag", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(disabled ? 0 : 1);
  await page.goto("/signup");
  await expect(page.getByText("Save your username and password somewhere safe.", { exact: false })).toHaveCount(disabled ? 1 : 0);
  for (const path of ["forgot-password", "forgot-username", "reset-password"]) {
    await page.goto(`/${path}`);
    if (disabled) {
      await expect(page.getByRole("heading", { name: "Account recovery is not available yet" })).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
    } else {
      await expect(page.locator("form")).toHaveCount(1);
    }
  }
});
