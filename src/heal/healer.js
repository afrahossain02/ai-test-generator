import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { HEAL_SYSTEM_PROMPT, buildHealPrompt } from "../generator/promptTemplates.js";
import { GenerationError, MissingApiKeyError } from "../utils/errors.js";
import { HealSuggestionSchema } from "./schema.js";

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * Asks Claude to diagnose one failing case, grounded in a live observation.
 *
 * One call per case rather than one for all of them: each failure has its own
 * error and its own observation, and batching them would invite the model to
 * pattern-match one case's fix onto another.
 *
 * @returns {Promise<{suggestion: object, usage: object}>}
 */
export async function healCase({
  testCase,
  error,
  observation,
  mode,
  model = DEFAULT_MODEL,
  client,
}) {
  const anthropic = client ?? createClient();

  const response = await anthropic.messages.parse({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: HEAL_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildHealPrompt(mode, testCase, error, observation) },
    ],
    output_config: { format: zodOutputFormat(HealSuggestionSchema, "heal_suggestion") },
  });

  if (response.stop_reason === "refusal") {
    throw new GenerationError(`Claude declined to diagnose ${testCase.id}.`, {
      hint: "Check the failure message for content that could read as a request to attack a real system.",
    });
  }
  if (!response.parsed_output) {
    throw new GenerationError(`Claude's diagnosis of ${testCase.id} did not match the expected schema.`, {
      hint: "Re-run the command — this is usually transient.",
    });
  }

  return { suggestion: { id: testCase.id, ...response.parsed_output }, usage: response.usage };
}

function createClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new MissingApiKeyError();
  }
  return new Anthropic();
}
