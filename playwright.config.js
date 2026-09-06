import { defineConfig, devices } from "@playwright/test";

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
      name: "ui",
      testMatch: /.*\.ui\.spec\.js$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.UI_BASE_URL ?? "https://www.saucedemo.com",
      },
    },
    {
      name: "api",
      testMatch: /.*\.api\.spec\.js$/,
      use: {
        baseURL: process.env.API_BASE_URL ?? "https://jsonplaceholder.typicode.com",
      },
    },
  ],
});
