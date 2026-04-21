import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared behavior for every page object:
 *  - navigation with a single wait convention
 *  - a helper for test-id-first locators with graceful fallbacks
 *  - a polling helper for product states (no hard sleeps)
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  async goto(path: string): Promise<void> {
    await this.page.goto(path, { waitUntil: "domcontentloaded" });
  }

  /**
   * Prefer `data-testid`; fall back to role/text/CSS only when the app has not
   * exposed a stable hook yet. Keeping this in BasePage means every page
   * object has one idiomatic way to build locators.
   */
  protected byTestIdOr(testId: string, fallback: Locator): Locator {
    return this.page.getByTestId(testId).or(fallback);
  }

  /**
   * Poll a state predicate until it returns true — the async equivalent of
   * a `while (!ready) sleep(500)` loop, but driven by Playwright's
   * auto-retrying expectations so no fixed `waitForTimeout` is used anywhere.
   */
  protected async pollUntil(
    predicate: () => Promise<boolean>,
    { timeout = 30_000, message }: { timeout?: number; message: string },
  ): Promise<void> {
    await expect
      .poll(predicate, {
        timeout,
        intervals: [250, 500, 1_000, 2_000, 3_000],
        message,
      })
      .toBeTruthy();
  }

  /** Convenience: dismiss a generic accessible dialog by its heading text. */
  protected async dismissDialogByHeading(pattern: RegExp): Promise<void> {
    const dialog = this.page.getByRole("dialog").filter({
      has: this.page.getByRole("heading", { name: pattern }),
    });
    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }
    const close = dialog.getByRole("button", { name: /^close$/i });
    if (await close.first().isVisible().catch(() => false)) {
      await close.first().click();
    } else {
      await this.page.keyboard.press("Escape");
    }
    await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  }
}
