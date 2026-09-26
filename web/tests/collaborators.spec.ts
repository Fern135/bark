import { expect, test } from "@playwright/test";

test("collaborator preview is accessible across editor views and responsive playback layouts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  const trigger = page.getByRole("button", { name: "Collaborators preview, 3 sample members", exact: true });
  const menu = page.getByRole("dialog", { name: "Collaborators", exact: true });

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("listitem")).toHaveCount(3);
  for (const name of ["You", "Alex", "Sam", "Owner", "Editor", "Viewer", "Away"]) {
    await expect(menu.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(menu.getByText("Online", { exact: true })).toHaveCount(2);
  await expect(menu.getByRole("button", { name: "Invite collaborator" })).toBeDisabled();
  await expect(menu.getByText("Invites and live collaboration are coming soon.")).toBeVisible();
  await page.screenshot({ path: "design/editor-collaborators-desktop.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  for (const view of ["Code", "Design", "Viewport"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await trigger.click();
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: "Close collaborators preview" }).click();
    await expect(trigger).toBeFocused();
  }
  await trigger.click();
  await page.getByRole("textbox", { name: "Project name" }).click();
  await expect(menu).toBeHidden();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  for (const width of [1586, 1366, 1280, 900, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 667 : 900 });
    await trigger.click();
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(width === 390 ? 667 : 900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["Pause", "Stop", "Restart", "Export JSON"]) {
      const button = page.getByRole("button", { name, exact: true });
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    if (width === 390) {
      for (const name of ["You", "Alex", "Sam"]) {
        await expect(trigger.getByTitle(name, { exact: true })).toBeVisible();
      }
      await page.screenshot({ path: "design/editor-collaborators-mobile.png", fullPage: true });
    }
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(errors).toEqual([]);
});

test("catalog editor keeps its back link and collaborator preview usable together", async ({ page }) => {
  await page.goto("/editor?game=woodland-wander");
  const back = page.getByRole("link", { name: "Back to game", exact: true });
  await expect(back).toHaveAttribute("href", "/games/woodland-wander");
  for (const width of [1366, 900, 390]) {
    await page.setViewportSize({ width, height: 768 });
    await page.getByRole("button", { name: "Collaborators preview, 3 sample members", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Collaborators", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(back).toBeInViewport();
    const box = await back.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  await back.click();
  await expect(page).toHaveURL(/\/games\/woodland-wander$/);
});
