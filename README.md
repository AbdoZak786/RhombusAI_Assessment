# Rhombus AI — Test Automation Framework

End-to-end UI, API, and data-validation automation for the [Rhombus AI](https://rhombusai.com/) web app. Built as a single-repo framework an SDET can run locally or from CI.

## Project overview

| Layer | Stack | Path | What it covers |
| --- | --- | --- | --- |
| UI | Playwright + TypeScript, **Page Object Model** | `ui-tests/` | Option A — AI Pipeline Flow: login → upload messy CSV → prompt → wait for completion → download enabled |
| API | Playwright `APIRequestContext` | `api-tests/` | Positive CSV upload (200/201 + `dataset_id`); negative `.txt` upload (400/422 + error message) |
| Data | Python + `pandas` | `data-validation/` | `validate_output.py` prints a Validation Report comparing messy input vs transformed output |

### Architecture

```
.
├── ui-tests/
│   ├── pages/
│   │   ├── BasePage.ts         # shared nav, polling, dialog utilities
│   │   └── PipelinePage.ts     # login + composer + pipeline status + download
│   ├── tests/
│   │   └── ai-pipeline-flow.spec.ts
│   ├── fixtures/messy.csv      # intentionally messy sample (nulls, dupes, bad header)
│   └── selectors.ts            # single source of data-testid names
├── api-tests/
│   ├── helpers/dataset-response.ts
│   └── tests/dataset-upload.spec.ts
├── data-validation/
│   ├── validate_output.py      # pandas-based Validation Report
│   ├── requirements.txt
│   ├── input.csv               # mirrors ui-tests/fixtures/messy.csv
│   └── output.csv              # expected transformed sample
├── playwright.config.ts        # ui + api projects, HTML reporter, video/trace on failure
├── .env.example
└── README.md
```

## Prerequisites

- Node.js 18+ and npm
- Python 3.10+ (for `data-validation/` only)

## Setup

1. **Install JavaScript dependencies**

   ```bash
   npm install
   ```

2. **Install Playwright browsers**

   ```bash
   npx playwright install
   ```

3. **Configure environment variables**

   ```bash
   copy .env.example .env     # Windows PowerShell
   # cp .env.example .env     # macOS / Linux
   ```

   Fill in at minimum:

   | Variable | Purpose |
   | --- | --- |
   | `BASE_URL` | Base URL for UI tests (default `https://rhombusai.com`). Rhombus serves both the marketing site and the authenticated product from the same host — the composer is only visible once logged in. |
   | `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | Credentials for the UI pipeline flow |
   | `E2E_LOGIN_PATH` / `E2E_PIPELINE_PATH` | Override if your workspace routes differ |
   | `E2E_PIPELINE_PROMPT` | Prompt text (default: `Clean this data and remove null rows`) |
   | `E2E_PIPELINE_TIMEOUT_MS` | Max time to wait for pipeline completion (default 180000) |
   | `API_DATASET_UPLOAD_URL` | Real multipart upload URL from DevTools Network |
   | `RHOMBUS_API_TOKEN` | JWT/API key (with or without `Bearer ` prefix — both tolerated) |

4. **Python dependencies (data validation)**

   ```bash
   cd data-validation
   python -m venv .venv
   .venv\Scripts\activate        # PowerShell: .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

## Execution

Run **all** Playwright projects (UI + API):

```bash
npx playwright test
```

Scoped runs:

```bash
npm run test:ui        # UI only
npm run test:api       # API only
npm run test:headed    # UI in a headed browser
npm run report         # Open the last HTML report
```

**UI in a headed browser (direct Playwright CLI, no `npx` on PATH):**

If `npx playwright` is not available, invoke the bundled CLI with Node from the repo root:

```powershell
# Windows (PowerShell / CMD)
node node_modules\@playwright\test\cli.js test --project=ui --headed
```

```bash
# macOS / Linux
node node_modules/@playwright/test/cli.js test --project=ui --headed
```

**Manual step during the UI run:** When the flow reaches the Rhombus preview step, **click Preview** in the product UI. That is the only interaction you need to perform by hand; the rest of the pipeline (upload, prompt, status polling, download) is automated.

Data validation (defaults to the CSVs next to the script):

```bash
cd data-validation
python validate_output.py
```

Custom paths or relaxed null policy:

```bash
python validate_output.py --input path\to\input.csv --output path\to\output.csv
python validate_output.py --allow-nulls
```

## Design notes

### Capturing a storage state (recommended for the UI flow)

Rhombus AI uses an Auth0 popup/redirect for login. Automating that click-through every run is brittle (popup blockers, MFA prompts, onboarding modals overlaying the Log In button). The framework supports Playwright's `storageState` pattern instead: log in **once** manually, persist the authenticated cookies/localStorage to disk, then every test run reuses that session.

1. Set `E2E_STORAGE_STATE=.auth/rhombus.json` in `.env` (already in `.env.example`).
2. Capture the state:

   ```powershell
   $env:E2E_CAPTURE_STATE=1
   npx playwright test --project=ui -g "AI Pipeline Flow"
   ```

   A headed Chromium opens. Log in, wait for the "Type a prompt, Build in Seconds" composer to appear, then press **Enter** in the terminal. The session is saved to `.auth/rhombus.json` (git-ignored).

3. Run the suite normally — the UI project now picks up `.auth/rhombus.json` and skips the login step entirely:

   ```powershell
   npx playwright test
   ```

If neither `E2E_STORAGE_STATE` nor `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` is set, the UI test self-skips with a message.

### Polling without hard sleeps

`PipelinePage.waitForPipelineCompleted(timeoutMs)` uses Playwright's built-in `expect.poll` with a back-off interval schedule (`[500, 1000, 2000, 3000]` ms) against the live status text. It first asserts the status **reaches** a completed/ready token and then re-asserts it is **no longer** in a processing state — no `page.waitForTimeout()` is used anywhere in the framework.

### Selector strategy

Every page object resolves its locators as `page.getByTestId(TestIds.x)` **or** a resilient fallback (role, label, placeholder, or a narrow CSS). When the product ships stable `data-testid` hooks (see `ui-tests/selectors.ts`) the tests silently prefer them and drop the fallbacks.

### API bearer tokens

`dataset-upload.spec.ts` strips a leading `Bearer ` from `RHOMBUS_API_TOKEN`/`API_BEARER_TOKEN` before re-prefixing it. Paste the token either way.

### Reading DevTools Network (Rhombus AI)

On `rhombusai.com` you will see `POST`s to paths like `/ph-rhombus/s/` — that is client analytics/session ingestion (PostHog-style proxied ingest), **not** the dataset upload API. Do not point `API_DATASET_UPLOAD_URL` at it. To find the real URL:

1. Open DevTools → **Network** → filter **Fetch/XHR**.
2. Upload a CSV in the authenticated product.
3. Select the request whose **Request payload** is `multipart/form-data` with a `file` field.
4. Copy that full URL into `API_DATASET_UPLOAD_URL`.

## Troubleshooting

- **UI test stalls on Auth0 hosted login.** Confirm `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` are set and that MFA is not required for the test account.
- **`400` on `/ph-rhombus/s/`.** Expected noise from analytics ingest — unrelated to the dataset API. Ignore and point `API_DATASET_UPLOAD_URL` at the product endpoint instead.
- **API tests skip.** They self-skip when `API_DATASET_UPLOAD_URL` is unset so the suite stays green for contributors without API credentials.
- **TypeScript can't find `tsc`.** Run `node node_modules/typescript/bin/tsc -p . --noEmit` (the repo ships a local TypeScript).

## Demo Video Link
(https://drive.google.com/file/d/1r_TfRgTdswV8ySvwu-1RlNjaHTuIJEC9/view?usp=sharing)
---

**Note:** Public marketing pages may differ from the authenticated product experience. Update `E2E_LOGIN_PATH`, `E2E_PIPELINE_PATH`, and selectors as needed once you confirm the live DOM inside your Rhombus AI workspace.
