import { z } from "zod";

import { TestStepSchema } from "../generator/schema.js";

/** What the model concluded about a failure. */
export const VERDICTS = ["test_is_wrong", "application_is_wrong", "unclear"];
export const CONFIDENCES = ["high", "medium", "low"];

export const HealSuggestionSchema = z.object({
  diagnosis: z
    .string()
    .describe("What the test expected, what is actually there, and which verdict this is."),
  verdict: z.enum(VERDICTS),
  confidence: z.enum(CONFIDENCES),
  steps: z.array(TestStepSchema).describe("Every step of the case in order, repaired where needed."),
  expectedResult: z.string(),
});
