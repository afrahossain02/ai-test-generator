import { defineConfig, devices } from "@playwright/test";

/**
 * Runs the specs written into generated-tests/ by `ai-testgen codegen`.
 *
 * baseURL is what lets a generated `page.goto('/')` point at a real site
 * without the generator having to know the host. Override it per run:
 *   BASE_URL=https://staging.example.com npx playwright test
 */
export default defineConfig({
  testDir: "./generated-tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "https://www.saucedemo.com",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
