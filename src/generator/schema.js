import { z } from "zod";

/**
 * The shape of a generated test plan.
 *
 * This module is the contract between phases: Phase 1 writes it, Phase 2's
 * Playwright codegen reads it, Phase 4's coverage report renders `rationale`.
 * There is no compiler here, so `parseTestPlan` is what actually enforces it —
 * every consumer should go through it rather than trusting a plain object.
 *
 * Two constraints come from strict JSON-schema output and are easy to trip over:
 *   - no `.optional()` fields; strict schemas require every property, so "absent"
 *     is expressed as "" or [].
 *   - no `z.record()`; open-ended maps don't survive strict schema conversion,
 *     which is why `testData` is an array of key/value pairs.
 */

export const CATEGORIES = [
  "happy_path",
  "edge_case",
  "negative",
  "boundary",
  "security",
];

export const PRIORITIES = ["P0", "P1", "P2"];

/** Display names, shared by the renderer, the code generator and the report. */
export const CATEGORY_LABELS = {
  happy_path: "Happy path",
  edge_case: "Edge cases",
  negative: "Negative",
  boundary: "Boundary",
  security: "Security",
};

export const TestStepSchema = z.object({
  action: z
    .string()
    .describe(
      'One concrete user action, specific enough to become a Playwright call. E.g. \'Click the "Sign in" button\'.',
    ),
  expectedObservation: z
    .string()
    .describe(
      "What should be observable immediately after this action. Empty string if there is nothing to assert yet.",
    ),
});

export const TestDataEntrySchema = z.object({
  key: z.string().describe('Name of the input, e.g. "email".'),
  value: z.string().describe('Literal value to use, e.g. "user@example.com".'),
});

export const TestCaseSchema = z.object({
  id: z.string().describe('Stable identifier, e.g. "TC-001".'),
  title: z
    .string()
    .describe("One line describing what is verified, phrased as an outcome."),
  category: z.enum(CATEGORIES),
  priority: z
    .enum(PRIORITIES)
    .describe("P0 blocks release, P1 is important, P2 is nice to have."),
  preconditions: z
    .array(z.string())
    .describe("State that must hold before step 1. Empty array if none."),
  steps: z.array(TestStepSchema).describe("Ordered steps. At least one."),
  expectedResult: z
    .string()
    .describe("The single overall outcome that makes this test pass."),
  rationale: z
    .string()
    .describe(
      "Why this case matters — the specific defect or risk it would catch. One or two sentences.",
    ),
  testData: z
    .array(TestDataEntrySchema)
    .describe("Concrete inputs this case uses. Empty array if none."),
});

/**
 * What the model is asked to return. `sourceType` and `generatedAt` are
 * deliberately excluded — we know those locally, and a model guessing at the
 * current date is a reliable way to get a wrong one.
 */
export const ModelOutputSchema = z.object({
  sourceSummary: z
    .string()
    .describe("One sentence restating the feature under test."),
  testCases: z.array(TestCaseSchema),
});

/** The full on-disk contract: model output plus the fields we add ourselves. */
export const TestPlanSchema = ModelOutputSchema.extend({
  sourceType: z.enum(["user_story", "openapi"]),
  generatedAt: z.string().describe("ISO 8601 timestamp."),
});

/** Throws a ZodError if `value` is not a valid test plan. */
export function parseTestPlan(value) {
  return TestPlanSchema.parse(value);
}

/** Non-throwing variant: returns { success, data | error }. */
export function safeParseTestPlan(value) {
  return TestPlanSchema.safeParse(value);
}

/** Counts of each category present in a plan, in CATEGORIES order. */
export function countByCategory(plan) {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const testCase of plan.testCases) {
    counts[testCase.category] += 1;
  }
  return counts;
}
