import fs from "fs";
import { defineConfig, devices } from "@playwright/test";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const baseURL = process.env.BASE_URL ?? "https://rhombusai.com";

// Only apply storageState if the file actually exists — otherwise Playwright
// hard-fails on context creation before a test can self-skip on missing creds.
const storageStatePath = process.env.E2E_STORAGE_STATE
  ? path.resolve(process.env.E2E_STORAGE_STATE)
  : undefined;
const storageState =
  storageStatePath && fs.existsSync(storageStatePath) ? storageStatePath : undefined;

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 300_000,
  expect: { timeout: 15_000 },
  globalSetup: require.resolve("./ui-tests/global-setup"),
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "ui",
      testDir: "./ui-tests/tests",
      use: {
        ...devices["Desktop Chrome"],
        storageState,
      },
    },
    {
      name: "api",
      testDir: "./api-tests/tests",
    },
  ],
});
