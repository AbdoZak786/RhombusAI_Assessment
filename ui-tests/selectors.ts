/**
 * Central map of `data-testid` values the app should expose for stable automation.
 * Fallback locators are chained in page objects when testids are not yet wired in production.
 */
export const TestIds = {
  loginEmail: "login-email",
  loginPassword: "login-password",
  loginSubmit: "login-submit",
  onboardingClose: "onboarding-close",
  pipelineFileInput: "pipeline-file-input",
  pipelinePrompt: "pipeline-prompt",
  pipelineRun: "pipeline-run",
  pipelineStatus: "pipeline-status",
  pipelineDownload: "pipeline-download",
} as const;
