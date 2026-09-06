import Anthropic from "@anthropic-ai/sdk";

/** Something went wrong in generation that is our problem, not the SDK's. */
export class GenerationError extends Error {
  constructor(message, { hint = "" } = {}) {
    super(message);
    this.name = "GenerationError";
    this.hint = hint;
  }
}

/** Raised before any request is made, when there is no usable credential. */
export class MissingApiKeyError extends GenerationError {
  constructor() {
    super("No ANTHROPIC_API_KEY found.", {
      hint: "Copy .env.example to .env and add your key, or run with --dry-run to use the bundled example plan.",
    });
    this.name = "MissingApiKeyError";
  }
}

/**
 * Turns any thrown value into { message, hint } for the CLI to print.
 * Checked most-specific-first; never string-matches on error text.
 */
export function describeError(error) {
  if (error instanceof GenerationError) {
    return { message: error.message, hint: error.hint };
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return {
      message: "Anthropic rejected the API key.",
      hint: "Check ANTHROPIC_API_KEY in your .env — keys start with 'sk-ant-'.",
    };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return {
      message: "Rate limited by the Anthropic API.",
      hint: "Wait a moment and run the same command again.",
    };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return {
      message: `The API rejected the request: ${error.message}`,
      hint: "This usually means an unsupported model id or a malformed schema.",
    };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return {
      message: "Could not reach the Anthropic API.",
      hint: "Check your network connection and try again.",
    };
  }
  if (error instanceof Anthropic.APIError) {
    return {
      message: `Anthropic API error ${error.status}: ${error.message}`,
      hint: "",
    };
  }
  if (error?.name === "ZodError") {
    return {
      message: "The generated plan did not match the expected schema.",
      hint: "Re-run the command; if it keeps happening the prompt in src/generator/promptTemplates.js needs tightening.",
    };
  }
  return { message: error?.message ?? String(error), hint: "" };
}
