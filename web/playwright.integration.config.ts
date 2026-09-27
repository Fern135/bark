import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/integration",
  outputDir: process.env.BARK_TEST_OUTPUT || "./.cache/integration-results",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: {
    baseURL: process.env.BARK_INTEGRATION_URL || "http://localhost:8080",
    channel: process.env.BARK_BROWSER_CHANNEL || "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
});
