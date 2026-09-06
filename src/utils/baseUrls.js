/**
 * Default targets for generated tests.
 *
 * Imported by both playwright.config.js and the heal command so a probe always
 * looks at the same host the failing test ran against.
 */
export const DEFAULT_UI_BASE_URL = "https://www.saucedemo.com";
export const DEFAULT_API_BASE_URL = "https://jsonplaceholder.typicode.com";

export function uiBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_UI_BASE_URL;
}

export function apiBaseUrl() {
  return process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
}
