import pc from "picocolors";

import { CATEGORIES, CATEGORY_LABELS, countByCategory } from "../generator/schema.js";

const CATEGORY_COLORS = {
  happy_path: pc.green,
  edge_case: pc.cyan,
  negative: pc.yellow,
  boundary: pc.magenta,
  security: pc.red,
};

const PRIORITY_COLORS = {
  P0: pc.red,
  P1: pc.yellow,
  P2: pc.dim,
};

/**
 * Renders a test plan as a string. Returns rather than prints so it can be
 * snapshot-tested; picocolors drops the escape codes when stdout isn't a TTY.
 */
export function renderTestPlan(plan) {
  const lines = [];

  lines.push("");
  lines.push(pc.bold(plan.sourceSummary));
  lines.push(pc.dim(`${plan.testCases.length} test cases · generated ${plan.generatedAt}`));
  lines.push("");
  lines.push(renderCoverageBar(plan));
  lines.push("");

  for (const category of CATEGORIES) {
    const cases = plan.testCases.filter((testCase) => testCase.category === category);
    if (cases.length === 0) continue;

    const color = CATEGORY_COLORS[category];
    lines.push(color(pc.bold(`${CATEGORY_LABELS[category]} (${cases.length})`)));
    lines.push(color("─".repeat(60)));

    for (const testCase of cases) {
      lines.push(...renderTestCase(testCase));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderTestCase(testCase) {
  const lines = [];
  const priority = PRIORITY_COLORS[testCase.priority](testCase.priority);

  lines.push(`  ${pc.bold(testCase.id)}  ${testCase.title}  ${priority}`);

  if (testCase.preconditions.length > 0) {
    lines.push(pc.dim(`      Given: ${testCase.preconditions.join("; ")}`));
  }

  testCase.steps.forEach((step, index) => {
    lines.push(`      ${pc.dim(`${index + 1}.`)} ${step.action}`);
    if (step.expectedObservation) {
      lines.push(pc.dim(`         → ${step.expectedObservation}`));
    }
  });

  lines.push(`      ${pc.bold("Expect:")} ${testCase.expectedResult}`);

  if (testCase.testData.length > 0) {
    const data = testCase.testData.map(({ key, value }) => `${key}=${value}`).join(", ");
    lines.push(pc.dim(`      Data: ${data}`));
  }

  lines.push(pc.dim(`      Why: ${testCase.rationale}`));
  lines.push("");

  return lines;
}

/** One-line coverage summary: which categories the plan actually reached. */
export function renderCoverageBar(plan) {
  const counts = countByCategory(plan);
  return CATEGORIES.map((category) => {
    const count = counts[category];
    const label = `${CATEGORY_LABELS[category]}: ${count}`;
    return count > 0 ? CATEGORY_COLORS[category](label) : pc.dim(label);
  }).join(pc.dim("  |  "));
}
