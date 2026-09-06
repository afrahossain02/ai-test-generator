import fs from "node:fs";

import { describe, it, expect } from "vitest";

import {
  parseTestPlan,
  safeParseTestPlan,
  countByCategory,
  CATEGORIES,
} from "../src/generator/schema.js";
import { fixtureTestPlanPath } from "../src/utils/paths.js";

const fixture = () => JSON.parse(fs.readFileSync(fixtureTestPlanPath, "utf8"));

describe("the test plan contract", () => {
  it("accepts the bundled fixture", () => {
    const plan = parseTestPlan(fixture());
    expect(plan.testCases).toHaveLength(10);
  });

  it("rejects a plan whose case is missing a rationale", () => {
    const plan = fixture();
    delete plan.testCases[0].rationale;
    expect(safeParseTestPlan(plan).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    const plan = fixture();
    plan.testCases[0].category = "smoke";
    expect(safeParseTestPlan(plan).success).toBe(false);
  });

  it("rejects a plan with no generatedAt", () => {
    const plan = fixture();
    delete plan.generatedAt;
    expect(safeParseTestPlan(plan).success).toBe(false);
  });

  it("round-trips through JSON, which is what Phase 2 will read", () => {
    const written = JSON.stringify(parseTestPlan(fixture()));
    expect(() => parseTestPlan(JSON.parse(written))).not.toThrow();
  });

  it("counts every category, including the ones at zero", () => {
    const counts = countByCategory(parseTestPlan(fixture()));
    expect(Object.keys(counts).sort()).toEqual([...CATEGORIES].sort());
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
  });

  it("covers all five categories in the example, so the demo shows real breadth", () => {
    const counts = countByCategory(parseTestPlan(fixture()));
    for (const category of CATEGORIES) {
      expect(counts[category], `fixture has no ${category} case`).toBeGreaterThan(0);
    }
  });
});
