import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

export async function verifyReferenceImports(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prepare Python", exact: true })).toBeEnabled();
  const exported = async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export game ↗" }).click();
    const path = await (await download).path();
    if (!path) throw new Error("Export did not produce a local download.");
    return JSON.parse(await readFile(path, "utf8"));
  };
  const importDocument = async (document: unknown) => {
    await page.locator('input[type="file"]').setInputFiles({ name: "review-regression.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  };
  const original = await exported();
  const badWorkspace = { blocks: { languageVersion: 0, blocks: [{ type: "bark_start", inputs: { DO: { block: { type: "bark_destroy", inputs: { ENTITY: { block: { type: "bark_entity", id: "missing", fields: { ENTITY: "deleted-enemy" } } } } } } } }] } };
  for (const script of [{ language: "blocks", workspace: badWorkspace }, { language: "python", source: "pass", blocksBackup: badWorkspace }]) {
    await importDocument({ ...original, script });
    await expect(page.getByRole("alert")).toContainText("Unknown entity reference: deleted-enemy");
    expect(await exported()).toEqual(original);
  }
  const incoming = structuredClone(original);
  incoming.project.name = "Incoming reference world";
  incoming.project.entities.find((e: { id: string }) => e.id === "player").id = "new-player";
  incoming.project.cameras.targetId = "new-player";
  const rewrite = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (value.fields?.ENTITY === "player") value.fields.ENTITY = "new-player";
    Object.values(value).forEach(rewrite);
  };
  rewrite(incoming.script.workspace);
  await importDocument(incoming);
  await expect(page.locator(".project-title")).toContainText("Incoming reference world");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Prepare Python", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("ready", { timeout: 45_000 });
  await page.getByRole("button", { name: "▶ Play", exact: true }).click();
  await expect(page.getByTestId("console")).toContainText("Collect the three gems");
  await page.getByRole("button", { name: "■ Stop", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText("idle");
  const restored = await exported();
  expect(restored.project.entities).toEqual(incoming.project.entities);
  expect(restored.script.workspace).toEqual(incoming.script.workspace);
}
