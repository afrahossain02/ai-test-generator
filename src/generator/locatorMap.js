import fs from "node:fs";
import path from "node:path";

import { GenerationError } from "../utils/errors.js";

/**
 * A locator map pins the names used in a plan to the test ids in an app.
 *
 * The default strategy — match a control by its visible label or placeholder —
 * is the right first guess, because a plan is written in the words a human
 * uses. It stops being right the moment an app labels nothing and identifies
 * everything by `data-testid`, which is most real apps. The map is the seam
 * between the two: plans stay readable, generated code stays robust.
 *
 * Shape:
 *   { "attribute": "data-test", "elements": { "Username": "username" } }
 *
 * The attribute is written into the generated file as a plain CSS selector
 * rather than relying on Playwright's `testIdAttribute` config, so a generated
 * spec is portable to any project without carrying a config change with it.
 */
export const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";

const ATTRIBUTE_PATTERN = /^[a-zA-Z][\w-]*$/;

export function parseLocatorMap(value, { filename = "locator map" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GenerationError(`${filename} must be a JSON object.`, {
      hint: 'Expected { "attribute": "data-testid", "elements": { "Name": "test-id" } }.',
    });
  }

  const attribute = value.attribute ?? DEFAULT_TEST_ID_ATTRIBUTE;
  if (!ATTRIBUTE_PATTERN.test(attribute)) {
    throw new GenerationError(`${filename} has an invalid attribute name: ${attribute}`, {
      hint: 'Use an HTML attribute name such as "data-testid" or "data-test".',
    });
  }

  const elements = value.elements ?? {};
  if (typeof elements !== "object" || Array.isArray(elements)) {
    throw new GenerationError(`${filename} has a malformed "elements" section.`, {
      hint: 'It maps the names used in the plan to test id values: { "Username": "username" }.',
    });
  }

  for (const [name, id] of Object.entries(elements)) {
    if (typeof id !== "string" || !id.trim()) {
      throw new GenerationError(`${filename} has no usable test id for "${name}".`, {
        hint: "Every entry must map a name to a non-empty string.",
      });
    }
  }

  return { attribute, elements };
}

export function loadLocatorMap(mapPath) {
  const resolved = path.resolve(mapPath);
  if (!fs.existsSync(resolved)) {
    throw new GenerationError(`No such file: ${resolved}`, {
      hint: "Generate a starter map with: ai-testgen locators --url <url> --out locators.json",
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new GenerationError(`${resolved} is not valid JSON: ${error.message}`, { hint: "" });
  }

  return parseLocatorMap(parsed, { filename: path.basename(resolved) });
}

/**
 * Builds a starter map from a probe observation.
 *
 * Keyed on the accessible name, because that is what a plan refers to. An
 * element with a test id but no name cannot be matched to a plan step, so it
 * is left out rather than guessed at.
 */
export function locatorMapFromObservation(observed) {
  const elements = {};
  let attribute = DEFAULT_TEST_ID_ATTRIBUTE;

  for (const element of observed.elements ?? []) {
    const name = (element.name ?? "").trim();
    if (!element.testId || !name || name.length > 60) continue;
    if (elements[name]) continue;
    elements[name] = element.testId;
    if (element.testIdAttribute) attribute = element.testIdAttribute;
  }

  return { attribute, elements };
}
