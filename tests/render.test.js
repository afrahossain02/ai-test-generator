import fs from "node:fs";

import { describe, it, expect } from "vitest";

import { renderTestPlan, renderCoverageBar } from "../src/utils/render.js";
import { parseTestPlan } from "../src/generator/schema.js";
import { fixtureTestPlanPath } from "../src/utils/paths.js";

const plan = parseTestPlan(JSON.parse(fs.readFileSync(fixtureTestPlanPath, "utf8")));

describe("renderTestPlan", () => {
  const output = renderTestPlan(plan);

  it("shows every test case", () => {
    for (const testCase of plan.testCases) {
      expect(output).toContain(testCase.id);
      expect(output).toContain(testCase.title);
    }
  });

  it("shows each step and its rationale", () => {
    const [first] = plan.testCases;
    expect(output).toContain(first.steps[0].action);
    expect(output).toContain(first.rationale);
  });

  it("groups cases under category headings", () => {
    expect(output).toContain("Happy path (2)");
    expect(output).toContain("Security (2)");
  });

  it("omits categories that have no cases", () => {
    const narrowed = { ...plan, testCases: plan.testCases.filter((c) => c.category === "security") };
    const narrowedOutput = renderTestPlan(narrowed);
    expect(narrowedOutput).toContain("Security (2)");
    expect(narrowedOutput).not.toContain("Happy path (");
  });
});

describe("renderCoverageBar", () => {
  it("lists every category, including empty ones, so gaps are visible", () => {
    const narrowed = { ...plan, testCases: plan.testCases.filter((c) => c.category === "security") };
    const bar = renderCoverageBar(narrowed);
    expect(bar).toContain("Security: 2");
    expect(bar).toContain("Happy path: 0");
    expect(bar).toContain("Boundary: 0");
  });
});
