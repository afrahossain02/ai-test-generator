import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, it, expect } from "vitest";

import {
  parseLocatorMap,
  locatorMapFromObservation,
  DEFAULT_TEST_ID_ATTRIBUTE,
} from "../src/generator/locatorMap.js";
import { generateAuthSetup, parseAuthProfile } from "../src/generator/authSetup.js";
import { generateSpec } from "../src/generator/codeGenerator.js";
import { parseTestPlan } from "../src/generator/schema.js";
import { GenerationError } from "../src/utils/errors.js";

const locators = parseLocatorMap(
  JSON.parse(fs.readFileSync("examples/saucedemo-locators.json", "utf8")),
);
const authProfile = parseAuthProfile(
  JSON.parse(fs.readFileSync("examples/saucedemo-auth.json", "utf8")),
);
const uiPlan = parseTestPlan(
  JSON.parse(fs.readFileSync("examples/saucedemo-testplan.json", "utf8")),
);

function checkSyntax(source, label) {
  const file = path.join(os.tmpdir(), `ai-testgen-${label}-${process.pid}.mjs`);
  fs.writeFileSync(file, source);
  try {
    expect(() => execFileSync(process.execPath, ["--check", file])).not.toThrow();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

describe("parseLocatorMap", () => {
  it("defaults the attribute when none is given", () => {
    expect(parseLocatorMap({ elements: { A: "a" } }).attribute).toBe(DEFAULT_TEST_ID_ATTRIBUTE);
  });

  it("keeps a custom attribute", () => {
    expect(locators.attribute).toBe("data-test");
    expect(locators.elements.Login).toBe("login-button");
  });

  it("rejects an attribute that is not an HTML attribute name", () => {
    expect(() => parseLocatorMap({ attribute: 'x"]:has(', elements: {} })).toThrow(GenerationError);
  });

  it("rejects an entry with no usable id", () => {
    expect(() => parseLocatorMap({ elements: { A: "" } })).toThrow(/no usable test id/i);
    expect(() => parseLocatorMap({ elements: { A: 42 } })).toThrow(GenerationError);
  });

  it("rejects a map that is not an object", () => {
    expect(() => parseLocatorMap([])).toThrow(GenerationError);
    expect(() => parseLocatorMap({ elements: [] })).toThrow(GenerationError);
  });

  it("accepts an empty map", () => {
    expect(parseLocatorMap({}).elements).toEqual({});
  });
});

describe("locatorMapFromObservation", () => {
  it("keys on accessible name and records the attribute in use", () => {
    const map = locatorMapFromObservation({
      elements: [
        { name: "Username", testId: "username", testIdAttribute: "data-test" },
        { name: "Login", testId: "login-button", testIdAttribute: "data-test" },
      ],
    });
    expect(map).toEqual({
      attribute: "data-test",
      elements: { Username: "username", Login: "login-button" },
    });
  });

  it("skips elements a plan could never refer to", () => {
    const map = locatorMapFromObservation({
      elements: [
        { name: "", testId: "anonymous" },
        { name: "Fine", testId: "" },
        { name: "x".repeat(100), testId: "verbose" },
      ],
    });
    expect(map.elements).toEqual({});
  });

  it("keeps the first of a duplicated name", () => {
    const map = locatorMapFromObservation({
      elements: [
        { name: "Go", testId: "first", testIdAttribute: "data-test" },
        { name: "Go", testId: "second", testIdAttribute: "data-test" },
      ],
    });
    expect(map.elements.Go).toBe("first");
  });
});

describe("generated specs with a locator map", () => {
  const withMap = generateSpec(uiPlan, { locators }).source;
  const withoutMap = generateSpec(uiPlan).source;

  it("embeds the map and the attribute", () => {
    expect(withMap).toContain("const TEST_ID_ATTRIBUTE = 'data-test';");
    expect(withMap).toContain('"Login": "login-button"');
  });

  it("prefers a mapped test id but keeps the label fallback", () => {
    expect(withMap).toContain("LOCATORS[name]\n    ? byTestId(page, name)");
    expect(withMap).toContain("page.getByLabel(name).or(page.getByPlaceholder(name)).first()");
  });

  it("routes role clicks through the helper, so a mapped button uses its test id", () => {
    expect(withMap).toContain("await byRole(page, 'button', 'Login').click();");
  });

  it("emits no map machinery when none is supplied", () => {
    expect(withoutMap).not.toContain("LOCATORS");
    expect(withoutMap).not.toContain("TEST_ID_ATTRIBUTE");
    expect(withoutMap).toContain("const byRole = (page, role, name) =>");
  });

  it("stays syntactically valid either way", () => {
    checkSyntax(withMap, "with-map");
    checkSyntax(withoutMap, "without-map");
  });
});

describe("generateAuthSetup", () => {
  const source = generateAuthSetup(authProfile, { locators });

  it("runs as a setup project and saves the session", () => {
    expect(source).toContain("import { test as setup, expect } from '@playwright/test';");
    expect(source).toContain("setup('authenticate as standard_user'");
    expect(source).toContain("await page.context().storageState({ path: AUTH_STATE });");
  });

  it("verifies the sign-in worked before saving anything", () => {
    // Saving an unauthenticated jar would hand every dependent test a session
    // that silently is not one.
    const assertionIndex = source.indexOf("await expect(page).toHaveURL");
    const saveIndex = source.indexOf("storageState({ path");
    expect(assertionIndex).toBeGreaterThan(-1);
    expect(assertionIndex).toBeLessThan(saveIndex);
  });

  it("uses the locator map for the sign-in fields", () => {
    expect(source).toContain("await field(page, 'Username').fill('standard_user');");
    expect(source).toContain('"Username": "username"');
  });

  it("refuses a profile with a step it cannot compile", () => {
    // A test case with one unreadable step still runs as far as it can. A
    // sign-in with one unreadable step authenticates nobody.
    const broken = { ...authProfile, steps: [{ action: "Do the needful", expectedObservation: "" }] };
    expect(() => generateAuthSetup(broken)).toThrow(/cannot be compiled/i);
  });

  it("refuses a profile whose expected result asserts nothing", () => {
    expect(() => generateAuthSetup({ ...authProfile, expectedResult: "It works" })).toThrow(
      /cannot be compiled/i,
    );
  });

  it("emits syntactically valid JavaScript", () => {
    checkSyntax(source, "auth-setup");
  });
});

describe("parseAuthProfile", () => {
  it("requires a name, url and at least one step", () => {
    expect(() => parseAuthProfile({ name: "", url: "/", steps: [], expectedResult: "x" })).toThrow(
      GenerationError,
    );
    expect(() => parseAuthProfile({ url: "/", steps: [], expectedResult: "" })).toThrow(
      GenerationError,
    );
  });

  it("accepts the bundled example", () => {
    expect(authProfile.name).toBe("standard_user");
    expect(authProfile.steps).toHaveLength(3);
  });
});
