import fs from "node:fs";

import { defineConfig, devices } from "@playwright/test";

import { uiBaseUrl, apiBaseUrl } from "./src/utils/baseUrls.js";
import { DEFAULT_AUTH_STATE_PATH } from "./src/generator/authSetup.js";

// Whether this project signs in is decided by the presence of a generated
// setup spec, not by the session file — the session does not exist until setup
// has run, and keying off it would leave the first run unauthenticated. When
// there is no setup spec, the ui project runs with no session, which is what a
// project needing no sign-in wants.
const TESTS_DIR = "./generated-tests";
const usesAuth =
  fs.existsSync(TESTS_DIR) && fs.readdirSync(TESTS_DIR).some((file) => file.endsWith(".setup.js"));

/**
 * Runs the specs written into generated-tests/ by `ai-testgen codegen`.
 *
 * UI and API tests target different hosts, so they are separate projects and
 * the code generator names files by mode (.ui.spec.js / .api.spec.js) to keep
 * them apart. Override either host per run:
 *   UI_BASE_URL=https://staging.example.com npx playwright test --project=ui
 *   API_BASE_URL=https://api.staging.example.com npx playwright test --project=api
 */
export default defineConfig({
  testDir: "./generated-tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // Signs in once and saves the session for the ui project to reuse.
      name: "setup",
      testMatch: /.*\.setup\.js$/,
      use: { ...devices["Desktop Chrome"], baseURL: uiBaseUrl() },
    },
    {
      name: "ui",
      testMatch: /.*\.ui\.spec\.js$/,
      dependencies: usesAuth ? ["setup"] : [],
      use: {
        ...devices["Desktop Chrome"],
        baseURL: uiBaseUrl(),
        storageState: usesAuth ? DEFAULT_AUTH_STATE_PATH : undefined,
      },
    },
    {
      name: "api",
      testMatch: /.*\.api\.spec\.js$/,
      use: {
        baseURL: apiBaseUrl(),
      },
    },
  ],
});
