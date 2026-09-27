import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(
  new URL("../public/models/starter/thumbnails/", import.meta.url),
);
await mkdir(root, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BARK_BROWSER_CHANNEL || "chrome",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1586, height: 992 },
  });
  await page.goto(
    `${process.argv[2] || "http://127.0.0.1:3000"}/editor?renderThumbnails`,
  );
  await page.waitForFunction(
    () => document.querySelector('img[data-model][src^="data:"]'),
    undefined,
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "Add object", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose a model", exact: true })
    .click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  const names = [
    "Byte",
    "Oak tree",
    "Pebble",
    "Wooden crate",
    "Bouncy ball",
    "Crystal",
    "Trail flag",
    "Stepping stone",
    "Wildflower",
    "Wooden bridge",
    "Leafy bush",
    "Garden fence",
    "Mushrooms",
    "Pine tree",
    "Camping tent",
    "Trail sign",
    "Little adventurer",
  ];
  const ids = [
    "player",
    "tree",
    "rock",
    "crate",
    "ball",
    "gem",
    "flag",
    "platform",
    "flower",
    "bridge",
    "bush",
    "fence",
    "mushroom",
    "pine",
    "tent",
    "sign",
    "robot",
  ];
  for (let i = 0; i < names.length; i++) {
    const source = await page
      .locator(`img[data-model="${names[i]}"]`)
      .first()
      .getAttribute("src");
    if (!source?.startsWith("data:image/png;base64,"))
      throw new Error(`Missing thumbnail: ${names[i]}`);
    await writeFile(
      `${root}/${ids[i]}.png`,
      Buffer.from(source.split(",")[1], "base64"),
    );
  }
  const world = await page
    .locator('img[data-model="Meadow"]')
    .getAttribute("src");
  await writeFile(
    `${root}/world.png`,
    Buffer.from(world.split(",")[1], "base64"),
  );
  console.log("Rendered 18 thumbnails from the actual model assets.");
} finally {
  await browser.close();
}
