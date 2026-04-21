import fs from "fs";
import path from "path";
import { test } from "@playwright/test";
import { PipelinePage } from "../pages/PipelinePage";

const describeName = "Option A – AI Pipeline Flow";

test.describe(describeName, () => {
  test("logs in, uploads messy CSV, runs prompt, waits for completion, download enabled", async ({
    page,
  }) => {
    const storageStatePath = process.env.E2E_STORAGE_STATE
      ? path.resolve(process.env.E2E_STORAGE_STATE)
      : undefined;
    const hasStorageState = Boolean(
      storageStatePath && fs.existsSync(storageStatePath),
    );

    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    test.skip(
      !hasStorageState && (!email || !password),
      "Provide either E2E_STORAGE_STATE (recommended for Auth0 flows) or E2E_USER_EMAIL + E2E_USER_PASSWORD.",
    );

    const loginPath = process.env.E2E_LOGIN_PATH ?? "/";
    const pipelinePath = process.env.E2E_PIPELINE_PATH ?? "/";

    const pipeline = new PipelinePage(page);

    if (hasStorageState) {
      // Session is restored via Playwright's storageState; go straight to the app.
      await pipeline.goto(pipelinePath);
    } else {
      if (!email || !password) {
        throw new Error("unreachable: credentials missing after skip gate");
      }
      await pipeline.openLogin(loginPath);
      await pipeline.login(email, password);
      // PipelinePage.login() already re-enters the app via "Open App" after
      // the Auth0 redirect, so we don't re-navigate to `pipelinePath` here —
      // that would take us back to the marketing landing.
    }

    const csvPath = path.join(__dirname, "..", "fixtures", "messy.csv");
    await pipeline.uploadCsv(csvPath);

    // Rhombus derives the project name from the prompt and rejects duplicates
    // with "A project with this name already exists." Prefix with a per-run
    // timestamp — leading because the server appears to derive the name from
    // the first N characters of the prompt, so a trailing suffix alone can
    // still collide when the base prompt is identical across runs.
    const basePrompt =
      process.env.E2E_PIPELINE_PROMPT ??
      "Clean this data and remove null rows";
      const prompt = `E2E run ${Date.now()} — ${basePrompt}`; 
    await pipeline.enterPrompt(prompt);
    await pipeline.runPipeline();

    const completionBudget = Number(process.env.E2E_PIPELINE_TIMEOUT_MS ?? 180_000);
    await pipeline.waitForPipelineCompleted(completionBudget);
    await pipeline.expectDownloadEnabled();
  });
});