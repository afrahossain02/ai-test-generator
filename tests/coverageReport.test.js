import fs from "node:fs";

import { describe, it, expect } from "vitest";

import { buildReport, percent } from "../src/report/coverage.js";
import { renderMarkdown, renderTerminal } from "../src/report/render.js";
import { parsePlaywrightResults, lookupStatus } from "../src/report/playwrightResults.js";
import { parseTestPlan } from "../src/generator/schema.js";
import { fixtureTestPlanPath } from "../src/utils/paths.js";

const uiPlan = parseTestPlan(JSON.parse(fs.readFileSync(fixtureTestPlanPath, "utf8")));
const apiPlan = parseTestPlan(
  JSON.parse(fs.readFileSync("examples/fixture-api-testplan.json", "utf8")),
);
const saucedemoPlan = parseTestPlan(
  JSON.parse(fs.readFileSync("examples/saucedemo-testplan.json", "utf8")),
);

/** Builds a Playwright-shaped report from [title, status] pairs. */
function playwrightReport(entries, file = "a.spec.js") {
  return {
    suites: [
      {
        file,
        specs: entries.map(([title, status]) => ({
          title,
          file,
          tests: [{ results: [{ status }] }],
        })),
      },
    ],
  };
}

describe("buildReport", () => {
  const report = buildReport(saucedemoPlan);

  it("counts cases and automation from the real code generator", () => {
    // Not a separate estimate: the report cannot claim a case is automated
    // when codegen would leave it as test.fixme.
    expect(report.totals.cases).toBe(6);
    expect(report.totals.automated).toBe(5);
    expect(report.totals.needsWork).toBe(1);
  });

  it("carries each case's rationale through", () => {
    for (const entry of report.cases) {
      expect(entry.rationale).toBeTruthy();
    }
  });

  it("records why a case could not be automated", () => {
    const blocked = report.cases.find((entry) => !entry.automated);
    expect(blocked.unresolved.length).toBeGreaterThan(0);
  });

  it("reports every category, including empty ones", () => {
    expect(report.byCategory).toHaveLength(5);
    expect(report.byCategory.map((entry) => entry.category)).toContain("boundary");
  });

  it("has no results until a run is supplied", () => {
    expect(report.hasResults).toBe(false);
    expect(report.cases.every((entry) => entry.status === "")).toBe(true);
  });
});

describe("gap detection", () => {
  it("flags a missing risk category as high severity", () => {
    const plan = parseTestPlan({
      ...uiPlan,
      testCases: uiPlan.testCases.filter((c) => c.category !== "security"),
    });
    const gap = buildReport(plan).gaps.find((g) => g.message.includes("security"));
    expect(gap.severity).toBe("high");
  });

  it("flags a P0 case that could not be automated", () => {
    const gap = buildReport(saucedemoPlan).gaps.find((g) => g.message.includes("P0"));
    expect(gap).toMatchObject({ severity: "high" });
    expect(gap.message).toContain("TC-006");
  });

  it("flags a low automation rate", () => {
    // The sign-in fixture is deliberately unautomatable — abstract steps.
    const gap = buildReport(uiPlan).gaps.find((g) => g.message.includes("compiled into runnable"));
    expect(gap.severity).toBe("medium");
  });

  it("flags failing tests when results are supplied", () => {
    const results = parsePlaywrightResults(
      playwrightReport(
        saucedemoPlan.testCases.map((c, i) => [
          `${c.id} · ${c.title}`,
          i === 0 ? "failed" : "passed",
        ]),
      ),
    );
    const gap = buildReport(saucedemoPlan, results).gaps.find((g) => g.message.includes("failing"));
    expect(gap.severity).toBe("high");
    expect(gap.message).toContain("TC-001");
  });

  it("flags plan cases that the supplied run says nothing about", () => {
    const results = parsePlaywrightResults(
      playwrightReport([[`${saucedemoPlan.testCases[0].id} · ${saucedemoPlan.testCases[0].title}`, "passed"]]),
    );
    const gap = buildReport(saucedemoPlan, results).gaps.find((g) => g.message.includes("no result"));
    expect(gap.severity).toBe("medium");
  });

  it("orders gaps worst first", () => {
    const order = { high: 0, medium: 1, low: 2 };
    const severities = buildReport(uiPlan).gaps.map((g) => order[g.severity]);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
  });

  it("says nothing when a plan is well covered", () => {
    const gaps = buildReport(apiPlan).gaps;
    expect(gaps.every((gap) => gap.severity === "low")).toBe(true);
  });
});

describe("parsePlaywrightResults", () => {
  it("indexes by full title, so ids colliding across plans do not overwrite", () => {
    // Every plan numbers from TC-001; keying on the id alone would let a
    // skipped UI case clobber a passing API case with the same number.
    const results = parsePlaywrightResults({
      suites: [
        { file: "a.ui.spec.js", specs: [{ title: "TC-001 · UI case", tests: [{ results: [{ status: "skipped" }] }] }] },
        { file: "b.api.spec.js", specs: [{ title: "TC-001 · API case", tests: [{ results: [{ status: "passed" }] }] }] },
      ],
    });
    expect(lookupStatus(results, "TC-001", "UI case")).toBe("skipped");
    expect(lookupStatus(results, "TC-001", "API case")).toBe("passed");
    expect(results.ambiguousIds).toContain("TC-001");
  });

  it("falls back to the id when a title was edited, if that id is unambiguous", () => {
    const results = parsePlaywrightResults(playwrightReport([["TC-007 · Original title", "passed"]]));
    expect(lookupStatus(results, "TC-007", "Renamed since generation")).toBe("passed");
  });

  it("refuses the id fallback when the id is ambiguous", () => {
    const results = parsePlaywrightResults({
      suites: [
        { specs: [{ title: "TC-001 · One", tests: [{ results: [{ status: "passed" }] }] }] },
        { specs: [{ title: "TC-001 · Two", tests: [{ results: [{ status: "passed" }] }] }] },
      ],
    });
    expect(lookupStatus(results, "TC-001", "Something else")).toBe("");
  });

  it("walks nested suites", () => {
    const results = parsePlaywrightResults({
      suites: [{ suites: [{ suites: [{ specs: [{ title: "TC-009 · Deep", tests: [{ results: [{ status: "passed" }] }] }] }] }] }],
    });
    expect(results.count).toBe(1);
  });

  it("ignores specs that are not generated cases", () => {
    const results = parsePlaywrightResults(playwrightReport([["a hand-written test", "failed"]]));
    expect(results.count).toBe(0);
  });

  it("treats a failure anywhere as the outcome", () => {
    const results = parsePlaywrightResults({
      suites: [
        { specs: [{ title: "TC-001 · X", tests: [{ results: [{ status: "passed" }, { status: "failed" }] }] }] },
      ],
    });
    expect(lookupStatus(results, "TC-001", "X")).toBe("failed");
  });

  it("counts a timeout as a failure", () => {
    const results = parsePlaywrightResults(playwrightReport([["TC-001 · X", "timedOut"]]));
    expect(lookupStatus(results, "TC-001", "X")).toBe("failed");
  });

  it("reports a fixme-skipped case as skipped, not failed", () => {
    const results = parsePlaywrightResults(playwrightReport([["TC-001 · X", "skipped"]]));
    expect(lookupStatus(results, "TC-001", "X")).toBe("skipped");
  });

  it("returns nothing for a case it never saw", () => {
    expect(lookupStatus(null, "TC-001", "X")).toBe("");
  });
});

describe("renderers", () => {
  const report = buildReport(saucedemoPlan);

  it("renders markdown with the case rationale", () => {
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("# Test coverage report");
    expect(markdown).toContain("**Why it matters:**");
    expect(markdown).toContain(saucedemoPlan.testCases[0].rationale);
  });

  it("marks an empty category in bold so a zero is visible in the table", () => {
    const plan = parseTestPlan({
      ...saucedemoPlan,
      testCases: saucedemoPlan.testCases.filter((c) => c.category !== "security"),
    });
    expect(renderMarkdown(buildReport(plan))).toContain("| Security | **0** | 0 |");
  });

  it("lists what blocks an unautomated case", () => {
    expect(renderMarkdown(report)).toContain("Blocking automation:");
  });

  it("renders a terminal summary with the gaps", () => {
    const text = renderTerminal(report);
    expect(text).toContain("Coverage report");
    expect(text).toContain("6 cases");
    expect(text).toContain("Gaps to review");
  });

  it("says so plainly when nothing is flagged", () => {
    const clean = { ...buildReport(apiPlan), gaps: [] };
    expect(renderTerminal(clean)).toContain("Nothing flagged");
    expect(renderMarkdown(clean)).toContain("Nothing flagged.");
  });
});

describe("percent", () => {
  it("rounds", () => {
    expect(percent(1, 3)).toBe(33);
  });

  it("does not divide by zero", () => {
    expect(percent(0, 0)).toBe(0);
  });
});
