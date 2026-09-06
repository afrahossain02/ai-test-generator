import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, it, expect } from "vitest";

import { generateSpec, slugify, summarizeStats } from "../src/generator/codeGenerator.js";
import { parseTestPlan } from "../src/generator/schema.js";
import { fixtureTestPlanPath } from "../src/utils/paths.js";

const signInPlan = parseTestPlan(JSON.parse(fs.readFileSync(fixtureTestPlanPath, "utf8")));
const saucedemoPlan = parseTestPlan(
  JSON.parse(fs.readFileSync("examples/saucedemo-testplan.json", "utf8")),
);

/** A minimal plan builder so each test states only what it cares about. */
function planWith(testCase) {
  return parseTestPlan({
    sourceType: "user_story",
    sourceSummary: "Example",
    generatedAt: "2026-01-01T00:00:00.000Z",
    testCases: [
      {
        id: "TC-001",
        title: "Example",
        category: "happy_path",
        priority: "P0",
        preconditions: [],
        steps: [],
        expectedResult: "",
        rationale: "",
        testData: [],
        ...testCase,
      },
    ],
  });
}

describe("generateSpec", () => {
  it("emits syntactically valid JavaScript", () => {
    // The generator writes source code, so "does it parse" is the floor.
    // A regex literal rendered as //foo/ would slip past every other assertion.
    for (const [name, plan] of [["sign-in", signInPlan], ["saucedemo", saucedemoPlan]]) {
      const file = path.join(os.tmpdir(), `ai-testgen-${name}-${process.pid}.mjs`);
      fs.writeFileSync(file, generateSpec(plan).source);
      try {
        expect(() => execFileSync(process.execPath, ["--check", file])).not.toThrow();
      } finally {
        fs.rmSync(file, { force: true });
      }
    }
  });

  it("groups tests into a describe block per category", () => {
    const { source } = generateSpec(signInPlan);
    expect(source).toContain("test.describe('Happy path', () => {");
    expect(source).toContain("test.describe('Security', () => {");
  });

  it("emits one test per case, titled with its id", () => {
    const { source, stats } = generateSpec(signInPlan);
    expect(stats.tests).toBe(signInPlan.testCases.length);
    for (const testCase of signInPlan.testCases) {
      expect(source).toContain(`${testCase.id} · ${testCase.title}`);
    }
  });

  it("keeps every step visible as a numbered comment, translated or not", () => {
    const { source } = generateSpec(signInPlan);
    for (const testCase of signInPlan.testCases) {
      testCase.steps.forEach((step, index) => {
        expect(source).toContain(`// ${index + 1}. ${step.action}`);
      });
    }
  });

  it("marks a test fixme when a step could not be translated", () => {
    const plan = planWith({
      steps: [{ action: "Do something inscrutable", expectedObservation: "" }],
      expectedResult: "The customer lands on /done",
    });
    const { source, stats } = generateSpec(plan);
    expect(stats.fixme).toBe(1);
    expect(stats.runnable).toBe(0);
    expect(source).toContain("test.fixme(");
    expect(source).toContain("// TODO: translate this step");
  });

  it("marks a test fixme when nothing in it could become an assertion", () => {
    // A test with no assertions passes by doing nothing — worse than an
    // openly unfinished one.
    const plan = planWith({
      steps: [{ action: "Navigate to /home", expectedObservation: "" }],
      expectedResult: "Everything is fine",
    });
    const { stats, source } = generateSpec(plan);
    expect(stats.assertions).toBe(0);
    expect(stats.fixme).toBe(1);
    expect(source).toContain("nothing in this case could be turned into an assertion");
  });

  it("emits a runnable test when every step and the outcome translate", () => {
    const plan = planWith({
      steps: [
        { action: "Navigate to /login", expectedObservation: "" },
        { action: 'Click the "Login" button', expectedObservation: "" },
      ],
      expectedResult: "The shopper lands on /home",
    });
    const { source, stats } = generateSpec(plan);
    expect(stats.runnable).toBe(1);
    expect(stats.fixme).toBe(0);
    expect(source).toContain("test('TC-001");
    expect(source).not.toContain("test.fixme(");
  });

  it("lists what needs attention above a fixme test", () => {
    const plan = planWith({
      steps: [{ action: "Frobnicate the widget", expectedObservation: "" }],
      expectedResult: "The shopper lands on /home",
    });
    expect(generateSpec(plan).source).toContain("- step 1: Frobnicate the widget");
  });

  it("records preconditions as comments", () => {
    const plan = planWith({
      preconditions: ["The account exists"],
      steps: [{ action: "Navigate to /login", expectedObservation: "" }],
      expectedResult: "The shopper lands on /home",
    });
    expect(generateSpec(plan).source).toContain("// Given: The account exists");
  });

  it("produces mostly runnable tests for the saucedemo example", () => {
    const { stats } = generateSpec(saucedemoPlan);
    expect(stats.runnable).toBeGreaterThanOrEqual(5);
    expect(stats.translatedSteps / stats.steps).toBeGreaterThan(0.9);
  });
});

describe("summarizeStats", () => {
  it("reports translated-step percentage", () => {
    const summary = summarizeStats({
      tests: 2,
      runnable: 1,
      fixme: 1,
      steps: 4,
      translatedSteps: 3,
      assertions: 5,
    });
    expect(summary).toContain("3/4 steps translated (75%)");
  });

  it("does not divide by zero on an empty plan", () => {
    expect(() =>
      summarizeStats({ tests: 0, runnable: 0, fixme: 0, steps: 0, translatedSteps: 0, assertions: 0 }),
    ).not.toThrow();
  });
});

describe("slugify", () => {
  it("makes a filename-safe stem", () => {
    expect(slugify("Sign-in for the Swag Labs demo storefront!")).toBe(
      "sign-in-for-the-swag-labs",
    );
  });

  it("falls back when there is nothing usable", () => {
    expect(slugify("!!!", "plan")).toBe("plan");
  });
});
