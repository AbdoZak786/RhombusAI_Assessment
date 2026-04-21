import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";
import { TestIds } from "../selectors";

const processingMatcher = /processing/i;
const completedMatcher = /completed|success|done|ready/i;

type AuthHost = Page | Frame;

type AuthSurface = {
  host: AuthHost;
  email: Locator;
  password: Locator;
  submit: Locator;
};

export class PipelinePage extends BasePage {
  private readonly promptInput: Locator;
  private readonly runButton: Locator;
  private readonly status: Locator;
  private readonly downloadButton: Locator;

  constructor(page: Page) {
    super(page);
    this.promptInput = page
      .getByTestId(TestIds.pipelinePrompt)
      .or(
        page.getByPlaceholder(
          /attach or drop|refine with rhombo|prompt|ask|describe|natural language/i,
        ),
      )
      .or(page.locator("textarea").first());

    this.runButton = page
      .getByTestId(TestIds.pipelineRun)
      .or(page.getByRole("button", { name: /run|execute|start|submit|apply|send/i }));

    this.status = page
      .getByTestId(TestIds.pipelineStatus)
      .or(
        page.locator(
          '[aria-live="polite"], [aria-live="assertive"], [role="status"]',
        ),
      )
      .first();

    this.downloadButton = page
      .getByTestId(TestIds.pipelineDownload)
      .or(page.getByRole("button", { name: /download results|download/i }));
  }

  private *eachAuthHost(): Generator<AuthHost> {
    for (const p of this.page.context().pages()) {
      yield p;
      for (const f of p.frames()) {
        if (f === p.mainFrame()) {
          continue;
        }
        yield f;
      }
    }
  }

  private buildAuthLocators(host: AuthHost): Omit<AuthSurface, "host"> {
    const email = host
      .getByTestId(TestIds.loginEmail)
      .or(host.getByLabel(/email|username|phone/i))
      .or(
        host.locator(
          [
            'input[name="username"]',
            "#username",
            'input[type="email"]',
            'input[type="text"][name="username"]',
            'input[type="text"][inputmode="email"]',
            'input[autocomplete="username"]',
            'input[autocomplete="email"]',
            'input[placeholder*="mail" i]',
            'input[placeholder*="email" i]',
            'input[id*="email" i]',
            'input[id*="username" i]',
          ].join(", "),
        ),
      )
      .first();
    const password = host
      .getByTestId(TestIds.loginPassword)
      .or(host.getByLabel(/^password$/i))
      .or(host.locator('input[type="password"], input[name="password"]'))
      .first();
    const submit = host
      .getByRole("button", {
        name: /continue|log\s*in|sign\s*in|verify|next|submit/i,
      })
      .first();
    return { email, password, submit };
  }

  private async pickAuthSurface(): Promise<AuthSurface | null> {
    for (const host of this.eachAuthHost()) {
      const locs = this.buildAuthLocators(host);
      if ((await locs.email.count()) === 0) {
        continue;
      }
      await locs.email.scrollIntoViewIfNeeded().catch(() => {});
      if (await locs.email.isVisible().catch(() => false)) {
        return { host, ...locs };
      }
      const box = await locs.email.boundingBox().catch(() => null);
      if (box && box.width > 2 && box.height > 2) {
        return { host, ...locs };
      }
    }
    return null;
  }

  private async waitForAuthSurface(): Promise<AuthSurface> {
    let surface: AuthSurface | null = null;
    await expect
      .poll(
        async () => {
          surface = await this.pickAuthSurface();
          return surface !== null;
        },
        {
          timeout: 90_000,
          intervals: [250, 500, 1_000, 2_000, 3_000],
          message:
            "No Auth0 / login username field appeared. Ensure BASE_URL reaches Rhombus, dismiss any onboarding modal, and that Log In reaches the hosted login (popup or redirect).",
        },
      )
      .toBeTruthy();
    if (!surface) {
      throw new Error("Auth surface missing after successful poll");
    }
    return surface;
  }

  /** Locator for the "Open App" CTA shown on the marketing landing page. */
  private openAppCta(): Locator {
    return this.page
      .getByRole("link", { name: /open app/i })
      .or(this.page.getByRole("button", { name: /open app/i }));
  }

  /**
   * The marketing page at rhombusai.com gates the product behind an "Open App"
   * CTA (top-right and hero). Click it to get to the authenticated shell /
   * Auth0 login. Handles same-tab navigation, new tab, and popup.
   */
  private async enterAppFromMarketingIfPresent(): Promise<void> {
    // Iterate candidates (marketing renders at least two Open App CTAs:
    // top-right nav + hero). Pick the first visible one, extract its href
    // if it is a link, and navigate the current tab directly — this avoids
    // the new-tab/popup race where `this.page` stays on marketing while the
    // app opens in another tab.
    const candidates = this.page
      .getByRole("link", { name: /open app/i })
      .or(this.page.getByRole("button", { name: /open app/i }));

    const total = await candidates.count();
    let targetHref: string | null = null;
    let clickFallback: Locator | null = null;
    for (let i = 0; i < total; i += 1) {
      const el = candidates.nth(i);
      if (!(await el.isVisible().catch(() => false))) {
        continue;
      }
      const href = await el.getAttribute("href").catch(() => null);
      if (href && !href.startsWith("#")) {
        targetHref = new URL(href, this.page.url()).toString();
        break;
      }
      clickFallback = el;
      break;
    }

    if (!targetHref && !clickFallback) {
      return;
    }

    if (targetHref) {
      await this.page.goto(targetHref, { waitUntil: "domcontentloaded" });
      return;
    }

    // Non-link Open App (button). Click it and wait for either a same-tab
    // navigation off "/" or a popup we can adopt.
    const popupPromise = this.page
      .waitForEvent("popup", { timeout: 10_000 })
      .catch(() => null);
    const navPromise = this.page
      .waitForURL((url) => !/rhombusai\.com\/?$/i.test(url.toString()), {
        timeout: 15_000,
      })
      .catch(() => null);
    await clickFallback!.click();
    const popup = await popupPromise;
    await navPromise;
    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
    }
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  /** True when the Rhombus shell looks authenticated (no guest gate / Log In / Open App CTA). */
  private async appearsLoggedIntoRhombusShell(): Promise<boolean> {
    const guestGate = this.page.getByText(/please log in to access projects/i);
    const logInCta = this.page.getByRole("button", { name: /log\s*in/i });
    const openAppCta = this.openAppCta();
    if (await guestGate.isVisible().catch(() => false)) {
      return false;
    }
    if (await logInCta.isVisible().catch(() => false)) {
      return false;
    }
    if (await openAppCta.first().isVisible().catch(() => false)) {
      return false;
    }
    return true;
  }

  private async openRhombusLoginEntry(): Promise<void> {
    if ((await this.pickAuthSurface()) !== null) {
      return;
    }
    // Marketing site → app gate. Must happen before the "already logged in?"
    // check, because the marketing page has no Log In button and would otherwise
    // be misread as authenticated.
    await this.enterAppFromMarketingIfPresent();
    if ((await this.pickAuthSurface()) !== null) {
      return;
    }
    if (await this.appearsLoggedIntoRhombusShell()) {
      return;
    }
    // Dismiss the tour first so no translucent backdrop remains over the
    // sidebar. The sidebar keeps its expanded layout (with Log In at bottom)
    // after dismissal on Rhombus, so this is strictly additive.
    await this.dismissStartBuildingIfPresent();

    // Rhombus renders multiple Log In DOM twins — the real one in the
    // bottom-left sidebar, plus hidden copies inside closed Radix popovers
    // (data-state="closed"). `.first()` picks a hidden twin, and
    // filter({visible:true}) chained on `.or()` unions does not filter them
    // out reliably. Iterate matches and click the first that is actually
    // visible on screen.
    const candidates = this.page
      .getByRole("button", { name: /^log\s*in$/i })
      .or(this.page.getByRole("link", { name: /^log\s*in$/i }))
      .or(this.page.getByRole("menuitem", { name: /^log\s*in$/i }));

    const popupPromise = this.page.waitForEvent("popup", { timeout: 20_000 });
    const urlPromise = this.page.waitForURL(/auth\.|auth0|authorize|\/login|\/u\/login/i, {
      timeout: 25_000,
    });

    await expect
      .poll(
        async () => {
          const total = await candidates.count();
          for (let i = 0; i < total; i += 1) {
            const btn = candidates.nth(i);
            if (!(await btn.isVisible().catch(() => false))) {
              continue;
            }
            // dispatchEvent fires a synthetic `click` directly on the target
            // element — bypassing any overlay that might still intercept
            // native pointer events even with force:true.
            await btn.dispatchEvent("click").catch(() => {});
            return true;
          }
          return false;
        },
        {
          timeout: 30_000,
          intervals: [250, 500, 1_000, 2_000],
          message: "No visible Log In button resolved on the Rhombus shell",
        },
      )
      .toBeTruthy();

    const popupReady = popupPromise.then((p) => p.waitForLoadState("domcontentloaded"));
    await Promise.race([popupReady, urlPromise]).catch(() => {});

    await this.page.waitForLoadState("domcontentloaded");
  }

  private async clickPrimaryAuthSubmit(host: AuthHost): Promise<void> {
    const btn = host
      .getByRole("button", {
        name: /continue|log\s*in|sign\s*in|verify|next|submit/i,
      })
      .first();
    await expect(btn).toBeEnabled({ timeout: 20_000 });
    await btn.click();
  }

  private async waitForSignedIntoRhombus(): Promise<void> {
    await expect
      .poll(
        async () => {
          const logInCta = this.page.getByRole("button", { name: /^log in$/i });
          return !(await logInCta.isVisible().catch(() => false));
        },
        {
          timeout: 120_000,
          intervals: [500, 1_000, 2_000, 3_000],
          message: "Still seeing Rhombus Log In after submitting credentials (check env or MFA).",
        },
      )
      .toBeTruthy();
    await this.page.waitForLoadState("domcontentloaded");
  }

  /**
   * Rhombus shows a "Start Building" onboarding dialog and may hide file inputs
   * until a project exists. Prefer the test-id close control when available.
   */
  private async dismissStartBuildingIfPresent(): Promise<void> {
    const tour = this.page
      .getByRole("dialog")
      .filter({ has: this.page.getByRole("heading", { name: /start building/i }) });
    if (!(await tour.isVisible().catch(() => false))) {
      return;
    }
    // Two observed dismissal paths on Rhombus:
    //   (a) Click the X close control at the dialog's top-right.
    //   (b) Step through the tour with the "Next" button until it auto-closes.
    // Try (a) first; if the close control isn't exposed, step through via (b).
    const close = tour
      .getByTestId(TestIds.onboardingClose)
      .or(tour.getByRole("button", { name: /^(close|dismiss|skip|skip tour|×)$/i }))
      .or(tour.locator('button[aria-label*="close" i], button[aria-label*="dismiss" i]'));
    const next = tour.getByRole("button", { name: /^next(:.+)?$/i });
    const finish = tour.getByRole("button", { name: /^(finish|done|got it|start|close)$/i });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      let acted = false;
      if (await close.first().isVisible().catch(() => false)) {
        await close.first().click({ force: true }).catch(() => {});
        acted = true;
      } else if (await finish.first().isVisible().catch(() => false)) {
        await finish.first().click({ force: true }).catch(() => {});
        acted = true;
      } else if (await next.first().isVisible().catch(() => false)) {
        await next.first().click({ force: true }).catch(() => {});
        acted = true;
      }
      if (!acted) {
        await this.page.keyboard.press("Escape").catch(() => {});
      }
      try {
        await tour.waitFor({ state: "hidden", timeout: 3_000 });
        return;
      } catch {
        // loop and try the next step
      }
    }
    // Last resort: click the backdrop outside the dialog body to close,
    // then Escape once more. Downstream steps use force-click so Log In is
    // still reachable if the tour refuses to close.
    await this.page.mouse.click(5, 5).catch(() => {});
    await this.page.keyboard.press("Escape").catch(() => {});
  }

  /**
   * Intentionally no-op in the default flow. Rhombus' "Create a project" CTA in
   * the empty-state sidebar navigates away from the composer (to /hub), which
   * breaks the upload step. The composer is reachable from the authenticated
   * landing page without creating a project first, as long as the onboarding
   * dialog is dismissed. Kept as a named extension point for flows that
   * genuinely require a project id before upload.
   */
  private async maybeCreateProjectForUpload(): Promise<void> {
    // no-op
  }

  /**
   * Main Rhombus composer: the toolbar/form that contains the
   * "Attach or drop…" field and its adjacent +/submit buttons. We anchor on
   * the placeholder's closest surrounding group — NOT on ancestor divs that
   * ALSO happen to contain the marketing heading — because the latter can
   * balloon up to an app-shell wrapper that includes the sidebar, and
   * `.first()` picks that outermost wrapper, making `getByRole("button")`
   * return the sidebar logo.
   */
  private composerPanel(): Locator {
    // Anchor on the actual input element, then walk up to the nearest
    // container that also contains at least one button. This yields the
    // composer toolbar row (attach, submit, prompt) and excludes the sidebar.
    return this.page
      .getByPlaceholder(/attach or drop|refine with rhombo|would you like to transform/i)
      .first()
      .locator('xpath=ancestor::*[.//button][1]');
  }

  private composerAttachButton(): Locator {
    // The attach control is an icon button inside the composer toolbar,
    // usually labelled for AT (Attach/Upload/Add) or exposing a Plus icon.
    // Prefer accessible-name matches, fall back to the first button in the
    // composer toolbar row.
    return this.composerPanel()
      .getByRole("button", { name: /attach|upload|add file|paperclip|plus|^\+$/i })
      .or(this.composerPanel().getByRole("button").first());
  }

  private composerSubmitButton(): Locator {
    // The send/submit control is the blue filled circular arrow-up button in
    // the composer toolbar: `bg-primary rounded-full h-8 w-8`. Targeting by
    // that class is far more stable than by accessible name (it has none)
    // or by index (both attach + send are icon buttons).
    return this.composerPanel().locator("button.rounded-full.bg-primary").first();
  }

  /**
   * Rhombus often mounts no `<input type="file">` until the "+" opens a native file chooser.
   * Prefer `filechooser` + `setFiles`; fall back to a discovered file input if one appears.
   */
  private async prepareComposerShell(): Promise<void> {
    await this.dismissStartBuildingIfPresent();
    const files = this.page.locator('input[type="file"]');
    if ((await files.count()) === 0) {
      await this.maybeCreateProjectForUpload();
    }
    await expect(
      this.promptInput,
      "Composer prompt field should be visible (set E2E_PIPELINE_PATH if your landing URL differs).",
    ).toBeVisible({ timeout: 60_000 });
  }

  private async uploadCsvViaFileChooser(filePath: string): Promise<void> {
    // Onboarding can reappear after login; ensure it is gone so the
    // composer attach button is not overlaid/obscured when we click it.
    await this.dismissStartBuildingIfPresent();
    await this.pollUntil(
      async () => {
        const tour = this.page
          .getByRole("dialog")
          .filter({ has: this.page.getByRole("heading", { name: /start building/i }) });
        return !(await tour.isVisible().catch(() => false));
      },
      { timeout: 15_000, message: "Start Building dialog never hid" },
    );

    const attach = this.composerAttachButton();
    await expect(attach, "Composer attach (+) control").toBeVisible({ timeout: 15_000 });
    await attach.scrollIntoViewIfNeeded().catch(() => {});
    const [chooser] = await Promise.all([
      this.page.waitForEvent("filechooser", { timeout: 20_000 }),
      attach.click({ force: false }),
    ]);
    await chooser.setFiles(filePath);
  }

  private async uploadCsvViaHiddenInput(filePath: string): Promise<void> {
    const input = this.page.locator('input[type="file"]').first();
    await expect(input).toBeAttached({ timeout: 15_000 });
    await input.setInputFiles(filePath);
  }

  async openLogin(loginPath: string): Promise<void> {
    await this.goto(loginPath);
  }

  /**
   * After Auth0 callback, Rhombus can bounce us back to the marketing page
   * and / or re-show the "Start Building" tour on the next app entry. Loop
   * through: dismiss-tour → click-open-app-if-visible → check for composer
   * until the authenticated composer (prompt field) is visible.
   */
  /**
   * "In the composer" means the authenticated app shell, not the marketing
   * hero. The Rhombus app and marketing both live on rhombusai.com/ (same
   * host + path), so URL alone cannot distinguish them. Key off shell-only
   * controls: "New Project" button and "Dashboard" nav item are rendered
   * only in the authenticated sidebar.
   */
  private async isInAuthenticatedComposer(): Promise<boolean> {
    const appShellSignals = this.page
      .getByRole("button", { name: /^new project$/i })
      .or(this.page.getByRole("link", { name: /^dashboard$/i }))
      .or(this.page.getByPlaceholder(/search projects/i));

    const total = await appShellSignals.count();
    for (let i = 0; i < total; i += 1) {
      if (await appShellSignals.nth(i).isVisible().catch(() => false)) {
        return true;
      }
    }
    return false;
  }

  private async ensureInComposer(): Promise<void> {
    await expect
      .poll(
        async () => {
          await this.dismissStartBuildingIfPresent();
          if (await this.isInAuthenticatedComposer()) {
            return true;
          }
          const openApp = this.page
            .getByRole("link", { name: /open app/i })
            .or(this.page.getByRole("button", { name: /open app/i }));
          const total = await openApp.count();
          for (let i = 0; i < total; i += 1) {
            const el = openApp.nth(i);
            if (!(await el.isVisible().catch(() => false))) {
              continue;
            }
            const href = await el.getAttribute("href").catch(() => null);
            if (href && !href.startsWith("#")) {
              await this.page.goto(new URL(href, this.page.url()).toString(), {
                waitUntil: "domcontentloaded",
              });
            } else {
              await el.click({ force: true }).catch(() => {});
            }
            await this.page.waitForLoadState("domcontentloaded").catch(() => {});
            break;
          }
          return this.isInAuthenticatedComposer();
        },
        {
          timeout: 60_000,
          intervals: [500, 1_000, 2_000, 3_000],
          message: "Authenticated composer never rendered after Auth0 callback",
        },
      )
      .toBeTruthy();
  }

  async login(email: string, password: string): Promise<void> {
    await this.dismissStartBuildingIfPresent();
    await this.openRhombusLoginEntry();
    if ((await this.pickAuthSurface()) === null && (await this.appearsLoggedIntoRhombusShell())) {
      await this.ensureInComposer();
      return;
    }
    const surface = await this.waitForAuthSurface();
    await expect(surface.email).toBeVisible({ timeout: 15_000 });
    await surface.email.fill(email);
    if (!(await surface.password.isVisible().catch(() => false))) {
      await surface.submit.click();
    }
    await expect(surface.password).toBeVisible({ timeout: 30_000 });
    await surface.password.fill(password);
    await this.clickPrimaryAuthSubmit(surface.host);
    await this.waitForSignedIntoRhombus();
    await this.ensureInComposer();
  }

  async uploadCsv(filePath: string): Promise<void> {
    await this.prepareComposerShell();
    try {
      await this.uploadCsvViaFileChooser(filePath);
    } catch {
      await this.uploadCsvViaHiddenInput(filePath);
    }
    await this.confirmAddFileDialogIfPresent();
  }

  /**
   * After `setFiles`, Rhombus presents an "Add New File" dialog with an
   * Attach / Cancel footer. The dialog blocks all further interaction with
   * the composer until dismissed. Click "Attach" to confirm the file so the
   * prompt field and Send button become reachable again.
   */
  private async confirmAddFileDialogIfPresent(): Promise<void> {
    const dialog = this.page
      .getByRole("dialog")
      .filter({ has: this.page.getByRole("heading", { name: /add new file/i }) });
    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }
    const attach = dialog.getByRole("button", { name: /^attach$/i });
    await expect(attach, "Add-New-File dialog Attach button").toBeEnabled({
      timeout: 15_000,
    });
    await attach.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  }

  async enterPrompt(text: string): Promise<void> {
    await expect(this.promptInput).toBeVisible();
    await this.promptInput.fill(text);
  }

  async runPipeline(): Promise<void> {
    // The composer submit button translates the prompt into a pipeline graph
    // on the Canvas. It does NOT itself execute the pipeline — the Canvas
    // then exposes a separate "Run Pipeline" CTA which actually processes
    // the attached CSV.
    await this.promptInput.click();
    const submit = this.composerSubmitButton();
    await expect(submit, "Submit control should enable after a file is attached").toBeEnabled({
      timeout: 60_000,
    });
    await submit.click();

    const runCanvas = this.page
      .getByRole("button", { name: /run pipeline/i })
      .or(this.page.getByRole("link", { name: /run pipeline/i }))
      .or(this.page.getByText(/^run pipeline$/i));

    // On some runs the composer-submit creates the project but does not
    // auto-navigate to its Canvas — probably because the dashboard composer
    // and the canvas composer share state and the dashboard remounts. If
    // Run Pipeline does not appear quickly, find the freshly-created
    // project entry in the sidebar and click it to open its canvas.
    if (!(await runCanvas.first().isVisible({ timeout: 8_000 }).catch(() => false))) {
      const sidebarItems = this.page
        .locator("aside, nav, [role='navigation'], [role='list']")
        .locator("a, [role='link'], [role='listitem']");
      const total = await sidebarItems.count();
      for (let i = 0; i < total; i += 1) {
        const el = sidebarItems.nth(i);
        const text = ((await el.textContent().catch(() => "")) ?? "").trim();
        if (/clean this data/i.test(text)) {
          await el.click({ force: true }).catch(() => {});
          break;
        }
      }
    }

    await expect(runCanvas.first(), "Canvas 'Run Pipeline' button").toBeVisible({
      timeout: 120_000,
    });
    // Toasts ("Project created successfully" etc.) can overlay the Canvas
    // toolbar on first render, intercepting clicks even with force:true.
    // Dismiss them by pressing Escape and click with a small retry.
    await this.page.keyboard.press("Escape").catch(() => {});
    await runCanvas.first().scrollIntoViewIfNeeded().catch(() => {});
    await runCanvas.first().click({ force: true }).catch(() => {});
  }

  /**
   * Waits until the pipeline finishes execution. Rhombus' canvas has no
   * single "status" element — the authoritative signal of completion is the
   * Download button (or a "Completed" badge that appears beside it). We use
   * a strict completion signal: a visible, enabled Download control OR a
   * pipeline-status testid element that explicitly matches "completed". We
   * intentionally do NOT scrape the full body text because the AI Builder
   * summary and toasts contain words like "ready" / "successfully" that
   * match loosely and would yield a false positive before the run starts.
   */
  async waitForPipelineCompleted(timeoutMs: number): Promise<void> {
    const completedSignal = async (): Promise<boolean> => {
      const byTestId = this.page.getByTestId(TestIds.pipelineStatus);
      if (await byTestId.count()) {
        const focused = (await byTestId.first().textContent())?.trim() ?? "";
        if (completedMatcher.test(focused)) {
          return true;
        }
      }
      const download = this.downloadButton.first();
      if (
        (await download.isVisible().catch(() => false)) &&
        (await download.isEnabled().catch(() => false))
      ) {
        return true;
      }
      return false;
    };

    await expect
      .poll(completedSignal, {
        timeout: timeoutMs,
        intervals: [500, 1_000, 2_000, 3_000],
        message:
          "Pipeline did not reach a completed state within the budget (no completed status, no enabled Download button)",
      })
      .toBeTruthy();
  }

  async expectDownloadEnabled(): Promise<void> {
    await expect(this.downloadButton).toBeEnabled({ timeout: 30_000 });
  }
}