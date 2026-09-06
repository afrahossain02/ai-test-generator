import { describe, it, expect } from "vitest";

import { generateTestPlan } from "../src/generator/testCaseGenerator.js";
import { GenerationError } from "../src/utils/errors.js";
import { parseTestPlan } from "../src/generator/schema.js";

const modelOutput = {
  sourceSummary: "Sign-in with email and password.",
  testCases: [
    {
      id: "TC-001",
      title: "Valid credentials sign the customer in",
      category: "happy_path",
      priority: "P0",
      preconditions: [],
      steps: [{ action: "Click Sign in", expectedObservation: "Lands on /account" }],
      expectedResult: "The customer reaches /account.",
      rationale: "The primary path.",
      testData: [],
    },
  ],
};

/** A stand-in for the Anthropic client; records the request it was given. */
function fakeClient(response) {
  const calls = [];
  return {
    calls,
    messages: {
      async parse(request) {
        calls.push(request);
        return {
          stop_reason: "end_turn",
          parsed_output: modelOutput,
          usage: { input_tokens: 1, output_tokens: 2 },
          model: "claude-opus-5",
          ...response,
        };
      },
    },
  };
}

describe("generateTestPlan", () => {
  it("returns a plan that satisfies the on-disk contract", async () => {
    const client = fakeClient();
    const { plan } = await generateTestPlan({ story: "As a user...", client });

    expect(() => parseTestPlan(plan)).not.toThrow();
    expect(plan.sourceType).toBe("user_story");
    expect(Number.isNaN(Date.parse(plan.generatedAt))).toBe(false);
  });

  it("stamps generatedAt locally rather than asking the model for it", async () => {
    const client = fakeClient();
    const before = Date.now();
    const { plan } = await generateTestPlan({ story: "As a user...", client });

    expect(Date.parse(plan.generatedAt)).toBeGreaterThanOrEqual(before - 1000);
    const requested = JSON.stringify(client.calls[0].output_config);
    expect(requested).not.toContain("generatedAt");
  });

  it("sends the story, the count and adaptive thinking", async () => {
    const client = fakeClient();
    await generateTestPlan({ story: "As a shopper I want to sign in", count: 7, client });

    const [request] = client.calls;
    expect(request.model).toBe("claude-opus-5");
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.messages[0].content).toContain("As a shopper I want to sign in");
    expect(request.messages[0].content).toContain("7 test cases");
  });

  it("honours an explicit model", async () => {
    const client = fakeClient();
    await generateTestPlan({ story: "story", model: "claude-sonnet-5", client });
    expect(client.calls[0].model).toBe("claude-sonnet-5");
  });

  it("refuses an empty story before making a request", async () => {
    const client = fakeClient();
    await expect(generateTestPlan({ story: "   ", client })).rejects.toThrow(GenerationError);
    expect(client.calls).toHaveLength(0);
  });

  it("reports a refusal instead of returning empty content", async () => {
    const client = fakeClient({ stop_reason: "refusal", parsed_output: null });
    await expect(generateTestPlan({ story: "story", client })).rejects.toThrow(/declined/i);
  });

  it("reports a truncated response rather than a half plan", async () => {
    const client = fakeClient({ stop_reason: "max_tokens" });
    await expect(generateTestPlan({ story: "story", client })).rejects.toThrow(/cut off/i);
  });

  it("reports a schema mismatch when parsed_output is null", async () => {
    const client = fakeClient({ parsed_output: null });
    await expect(generateTestPlan({ story: "story", client })).rejects.toThrow(/schema/i);
  });
});
