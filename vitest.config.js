import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only this project's own tests. Without this, vitest would also pick up
    // the *.spec.js files in generated-tests/, which belong to Playwright.
    include: ["tests/**/*.test.js"],
  },
});
