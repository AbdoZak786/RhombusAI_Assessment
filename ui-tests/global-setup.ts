import fs from "fs";
import path from "path";
import { chromium, type FullConfig } from "@playwright/test";

/**
 * Optional global setup: if a reusable storageState file is configured and
 * missing, launch a headed browser so the user can log in once manually.
 * After the user completes login the session is persisted for all subsequent
 * headless runs. Skipped entirely when E2E_STORAGE_STATE is unset.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const statePath = process.env.E2E_STORAGE_STATE;
  if (!statePath) {
    return;
  }
  const absolute = path.resolve(statePath);
  if (fs.existsSync(absolute)) {
    return;
  }
  if (process.env.E2E_CAPTURE_STATE !== "1") {
    // Don't hijack CI runs. To capture: run with E2E_CAPTURE_STATE=1.
    return;
  }

  const baseURL = process.env.BASE_URL ?? "https://rhombusai.com";
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });

  console.log(
    "\n[global-setup] Log in to Rhombus AI in the opened browser window.\n" +
      "Once the authenticated composer ('Type a prompt, Build in Seconds') is visible,\n" +
      "press ENTER in this terminal to persist the session to:\n" +
      `  ${absolute}\n`,
  );
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  await context.storageState({ path: absolute });
  await browser.close();
  console.log(`[global-setup] Saved storage state to ${absolute}`);
}
