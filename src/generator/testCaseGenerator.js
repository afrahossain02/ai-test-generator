import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { ModelOutputSchema } from "./schema.js";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  API_SYSTEM_PROMPT,
  buildApiUserPrompt,
} from "./promptTemplates.js";
import { GenerationError, MissingApiKeyError } from "../utils/errors.js";

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * Asks Claude for a test plan and returns it validated.
 *
 * Uses messages.parse() with a Zod-derived output format, so the model returns
 * a schema-checked object rather than prose we would have to fish JSON out of.
 *
 * @param {object} options
 * @param {string} options.story - raw user story text
 * @param {number} [options.count] - target number of test cases
 * @param {string} [options.model]
 * @param {Anthropic} [options.client] - injectable for tests
 * @returns {Promise<{plan: object, usage: object, model: string}>}
 */
export async function generateTestPlan({
  story,
  count = 10,
  model = DEFAULT_MODEL,
  client,
}) {
  if (!story?.trim()) {
    throw new GenerationError("The user story is empty.", {
      hint: "Pass --story <path> pointing at a non-empty file, or --text \"...\".",
    });
  }

  return requestPlan({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(story, count),
    sourceType: "user_story",
    model,
    client,
  });
}

/**
 * Asks Claude for an API test plan built from parsed OpenAPI operations.
 *
 * @param {object} options
 * @param {object} options.spec - result of parseOpenApi()
 * @param {string} options.operationsBlock - rendered endpoint summary
 * @param {number} [options.count]
 * @param {string} [options.model]
 * @param {object} [options.client]
 */
export async function generateApiTestPlan({
  spec,
  operationsBlock,
  count = 10,
  model = DEFAULT_MODEL,
  client,
}) {
  if (!operationsBlock?.trim()) {
    throw new GenerationError("No endpoints to generate tests for.", {
      hint: "Loosen or drop --filter; it matched none of the operations in the spec.",
    });
  }

  return requestPlan({
    system: API_SYSTEM_PROMPT,
    user: buildApiUserPrompt(spec, operationsBlock, count),
    sourceType: "openapi",
    model,
    client,
  });
}

/** The one place a request is actually made, so both entrypoints fail alike. */
async function requestPlan({ system, user, sourceType, model, client }) {
  const anthropic = client ?? createClient();

  const response = await anthropic.messages.parse({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(ModelOutputSchema, "test_plan") },
  });

  // Check why generation stopped before trusting the content.
  if (response.stop_reason === "refusal") {
    throw new GenerationError("Claude declined to generate a plan for this story.", {
      hint: "Rephrase the user story, or check it for content that could read as a request to attack a real system.",
    });
  }
  if (response.stop_reason === "max_tokens") {
    throw new GenerationError("The response was cut off before the plan was complete.", {
      hint: "Ask for fewer cases with --count.",
    });
  }

  // parsed_output is null when the response did not validate against the schema.
  if (!response.parsed_output) {
    throw new GenerationError("Claude returned a response that did not match the test plan schema.", {
      hint: "Re-run the command — this is usually transient.",
    });
  }

  const plan = {
    ...response.parsed_output,
    sourceType,
    generatedAt: new Date().toISOString(),
  };

  return { plan, usage: response.usage, model: response.model };
}

function createClient() {
  // The SDK also accepts ANTHROPIC_AUTH_TOKEN and an `ant auth login` profile,
  // so only fail fast when there is clearly nothing to authenticate with.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new MissingApiKeyError();
  }
  return new Anthropic();
}
