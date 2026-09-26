import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
export default defineConfig({
  ...config,
  testMatch: ["production.spec.ts", "player.spec.ts"],
  use: { ...config.use, baseURL: "http://127.0.0.1:4174" },
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
