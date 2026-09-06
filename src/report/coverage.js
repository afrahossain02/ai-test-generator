import {
  CATEGORIES,
  CATEGORY_LABELS,
  PRIORITIES,
  countByCategory,
} from "../generator/schema.js";
import { generateSpec } from "../generator/codeGenerator.js";
import { lookupStatus } from "./playwrightResults.js";

/**
 * Builds a coverage report from a test plan.
 *
 * Deterministic and offline: no API call. The "why this matters" explanation
 * the report surfaces was already written by the model at generation time and
 * stored on each case as `rationale` — asking again would cost money to
 * produce a second, differently-worded answer to a question already answered.
 *
 * Automation figures come from compiling the plan with the real code
 * generator rather than from a separate estimate, so the report cannot claim
 * a case is automated when codegen would leave it as test.fixme.
 *
 * @param {object} plan - a plan that has been through parseTestPlan()
 * @param {object} [results] - output of parsePlaywrightResults(), or null
 */
export function buildReport(plan, results = null) {
  const { stats, mode } = generateSpec(plan);
  const byId = new Map(stats.cases.map((entry) => [entry.id, entry]));

  const cases = plan.testCases.map((testCase) => {
    const compiled = byId.get(testCase.id);
    return {
      id: testCase.id,
      title: testCase.title,
      category: testCase.category,
      priority: testCase.priority,
      rationale: testCase.rationale,
      automated: compiled?.automated ?? false,
      assertions: compiled?.assertions ?? 0,
      unresolved: compiled?.unresolved ?? [],
      status: lookupStatus(results, testCase.id, testCase.title),
    };
  });

  const categoryCounts = countByCategory(plan);
  const byCategory = CATEGORIES.map((category) => {
    const inCategory = cases.filter((entry) => entry.category === category);
    return {
      category,
      label: CATEGORY_LABELS[category],
      count: categoryCounts[category],
      automated: inCategory.filter((entry) => entry.automated).length,
    };
  });

  const byPriority = Object.fromEntries(
    PRIORITIES.map((priority) => [priority, cases.filter((c) => c.priority === priority).length]),
  );

  return {
    sourceSummary: plan.sourceSummary,
    sourceType: plan.sourceType,
    generatedAt: plan.generatedAt,
    mode,
    totals: {
      cases: cases.length,
      automated: stats.runnable,
      needsWork: stats.fixme,
      assertions: stats.assertions,
      steps: stats.steps,
      translatedSteps: stats.translatedSteps,
    },
    byCategory,
    byPriority,
    cases,
    hasResults: Boolean(results?.count),
    results: tallyResults(cases),
    gaps: findGaps({ cases, byCategory, byPriority, totals: stats, hasResults: Boolean(results?.count) }),
  };
}

function tallyResults(cases) {
  const tally = { passed: 0, failed: 0, skipped: 0, unknown: 0 };
  for (const entry of cases) {
    if (entry.status && entry.status in tally) tally[entry.status] += 1;
  }
  return tally;
}

/**
 * Findings a reviewer should act on, worst first.
 *
 * These are deliberately mechanical — each one names a fact about the plan
 * that a human can verify in seconds. A vague "consider more coverage" would
 * be noise; "no security cases at all" is a decision to make.
 */
function findGaps({ cases, byCategory, byPriority, totals, hasResults }) {
  const gaps = [];
  const RISK_CATEGORIES = new Set(["negative", "boundary", "security"]);

  for (const entry of byCategory) {
    if (entry.count === 0) {
      gaps.push({
        severity: RISK_CATEGORIES.has(entry.category) ? "high" : "medium",
        message: `No ${entry.label.toLowerCase()} cases at all.`,
        detail: RISK_CATEGORIES.has(entry.category)
          ? "This is one of the categories where untested defects reach production quietly."
          : "The plan may be describing the feature rather than testing it.",
      });
    }
  }

  const failing = cases.filter((entry) => entry.status === "failed");
  if (failing.length > 0) {
    gaps.push({
      severity: "high",
      message: `${failing.length} test${failing.length === 1 ? "" : "s"} failing: ${failing.map((e) => e.id).join(", ")}.`,
      detail: "A failing generated test is either a real defect or a locator that needs correcting.",
    });
  }

  if (hasResults) {
    const unmatched = cases.filter((entry) => !entry.status);
    if (unmatched.length > 0) {
      gaps.push({
        severity: "medium",
        message: `${unmatched.length} case${unmatched.length === 1 ? "" : "s"} had no result in the supplied run: ${unmatched.map((e) => e.id).join(", ")}.`,
        detail:
          "Either the specs were not regenerated after the plan changed, or the results file is from a different run.",
      });
    }
  }

  const blockedP0 = cases.filter((entry) => entry.priority === "P0" && !entry.automated);
  if (blockedP0.length > 0) {
    gaps.push({
      severity: "high",
      message: `${blockedP0.length} P0 case${blockedP0.length === 1 ? "" : "s"} could not be automated: ${blockedP0.map((e) => e.id).join(", ")}.`,
      detail: "Release-blocking cases are the ones least worth leaving as a manual step.",
    });
  }

  if (byPriority.P0 === 0 && cases.length > 0) {
    gaps.push({
      severity: "medium",
      message: "No case is marked P0.",
      detail: "Either the feature carries no release-blocking risk, or the priorities were not thought through.",
    });
  }

  const automationRate = cases.length === 0 ? 1 : totals.runnable / cases.length;
  if (automationRate < 0.6 && cases.length > 0) {
    gaps.push({
      severity: "medium",
      message: `Only ${Math.round(automationRate * 100)}% of cases compiled into runnable tests.`,
      detail: "Most of this plan still needs finishing by hand. Check whether the steps are phrased in shapes the translator understands.",
    });
  }

  const thin = byCategory.filter((entry) => entry.count === 1);
  const rich = byCategory.filter((entry) => entry.count >= 3);
  if (rich.length > 0) {
    for (const entry of thin) {
      gaps.push({
        severity: "low",
        message: `Only one ${entry.label.toLowerCase()} case, against ${Math.max(...rich.map((r) => r.count))} elsewhere.`,
        detail: "Uneven depth usually means a category was filled to satisfy the format rather than the risk.",
      });
    }
  }

  const unexplained = cases.filter((entry) => !entry.rationale?.trim());
  if (unexplained.length > 0) {
    gaps.push({
      severity: "low",
      message: `${unexplained.length} case${unexplained.length === 1 ? "" : "s"} carry no rationale.`,
      detail: "A case that cannot say what defect it catches is hard to defend in review.",
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return gaps.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Percentage helper that does not divide by zero. */
export function percent(part, whole) {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
