import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "hosting.spec.ts",
  outputDir: "../.cache/hosting-playwright",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3112",
    channel: process.env.BARK_BROWSER_CHANNEL || "chrome",
  },
  webServer: {
    command: "node scripts/serve-editor-test.mjs",
    env: { BARK_TEST_PORT: "3112" },
    url: "http://127.0.0.1:3112/health/ready",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
