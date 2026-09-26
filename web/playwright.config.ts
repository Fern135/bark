import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: "**/integration/**",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3101",
    channel: process.env.BARK_BROWSER_CHANNEL || "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
  },
  webServer: {
    command: "node scripts/serve-editor-test.mjs",
    url: "http://127.0.0.1:3101/editor",
    reuseExistingServer: process.env.BARK_REUSE_SERVER === "1",
    timeout: 60_000,
  },
});
