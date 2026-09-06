import pc from "picocolors";

import { parseTestPlan } from "../generator/schema.js";

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

/**
 * Decides which suggestions to act on and produces the patched plan.
 *
 * Healing edits the PLAN, not the generated spec file. The spec is build
 * output — regenerating would throw a patched spec away — so a fix that lives
 * in the plan is the only one that survives the next `codegen`.
 *
 * Two suggestions are never applied automatically: a verdict of
 * application_is_wrong (that is a defect to look at, not a test to rewrite)
 * and anything below the confidence floor.
 */
export function applySuggestions(plan, suggestions, { minConfidence = "medium" } = {}) {
  const floor = CONFIDENCE_RANK[minConfidence] ?? 1;
  const decisions = [];

  const byId = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));

  const testCases = plan.testCases.map((testCase) => {
    const suggestion = byId.get(testCase.id);
    if (!suggestion) return testCase;

    const decision = decide(suggestion, floor);
    decisions.push({ id: testCase.id, title: testCase.title, suggestion, ...decision });

    if (!decision.applied) return testCase;
    return { ...testCase, steps: suggestion.steps, expectedResult: suggestion.expectedResult };
  });

  // Re-validated so a repair can never write a plan that codegen would reject.
  return { plan: parseTestPlan({ ...plan, testCases }), decisions };
}

function decide(suggestion, floor) {
  if (suggestion.verdict === "application_is_wrong") {
    return {
      applied: false,
      reason: "reported as a suspected defect — the test looks right, the application does not",
    };
  }
  if (suggestion.verdict === "unclear") {
    return { applied: false, reason: "diagnosis was inconclusive" };
  }
  if ((CONFIDENCE_RANK[suggestion.confidence] ?? 0) < floor) {
    return { applied: false, reason: `confidence ${suggestion.confidence} is below the floor` };
  }
  return { applied: true, reason: "" };
}

const VERDICT_LABEL = {
  test_is_wrong: "test needs repair",
  application_is_wrong: "suspected defect",
  unclear: "inconclusive",
};

const VERDICT_COLOR = {
  test_is_wrong: pc.yellow,
  application_is_wrong: pc.red,
  unclear: pc.dim,
};

/** Human-readable account of what changed and what deliberately did not. */
export function renderDecisions(plan, decisions) {
  const original = new Map(plan.testCases.map((testCase) => [testCase.id, testCase]));
  const lines = [];

  for (const decision of decisions) {
    const { suggestion } = decision;
    const color = VERDICT_COLOR[suggestion.verdict];

    lines.push("");
    lines.push(
      `${pc.bold(decision.id)} · ${decision.title}  ` +
        `${color(`[${VERDICT_LABEL[suggestion.verdict]}]`)} ${pc.dim(`confidence: ${suggestion.confidence}`)}`,
    );
    lines.push(`  ${suggestion.diagnosis}`);

    if (!decision.applied) {
      lines.push(`  ${pc.dim(`Not applied — ${decision.reason}.`)}`);
      continue;
    }

    const before = original.get(decision.id);
    const changes = diffCase(before, suggestion);
    if (changes.length === 0) {
      lines.push(`  ${pc.dim("No textual change.")}`);
      continue;
    }
    for (const change of changes) {
      lines.push(`  ${pc.red(`- ${change.before}`)}`);
      lines.push(`  ${pc.green(`+ ${change.after}`)}`);
    }
  }

  return lines.join("\n");
}

/** Line-level differences between a case and its repaired version. */
export function diffCase(before, suggestion) {
  const changes = [];
  const length = Math.max(before.steps.length, suggestion.steps.length);

  for (let index = 0; index < length; index += 1) {
    const from = before.steps[index];
    const to = suggestion.steps[index];

    if (from?.action !== to?.action) {
      changes.push({ before: from?.action ?? "(no step)", after: to?.action ?? "(removed)" });
    }
    if (from?.expectedObservation !== to?.expectedObservation) {
      changes.push({
        before: from?.expectedObservation || "(nothing asserted)",
        after: to?.expectedObservation || "(nothing asserted)",
      });
    }
  }

  if (before.expectedResult !== suggestion.expectedResult) {
    changes.push({ before: before.expectedResult, after: suggestion.expectedResult });
  }

  return changes;
}
