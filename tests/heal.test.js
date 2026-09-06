import { describe, it, expect } from "vitest";

import { deriveTarget, resolveUrl } from "../src/heal/target.js";
import { applySuggestions, diffCase, renderDecisions } from "../src/heal/apply.js";
import { renderObservation } from "../src/heal/probe.js";
import { healCase } from "../src/heal/healer.js";
import { parseUiIntent } from "../src/generator/stepTranslator.js";
import { parseTestPlan } from "../src/generator/schema.js";
import { GenerationError } from "../src/utils/errors.js";

function planWith(overrides) {
  return parseTestPlan({
    sourceType: "user_story",
    sourceSummary: "Example",
    generatedAt: "2026-01-01T00:00:00.000Z",
    testCases: [
      {
        id: "TC-001",
        title: "Sign in",
        category: "happy_path",
        priority: "P0",
        preconditions: [],
        steps: [
          { action: "Navigate to /login", expectedObservation: "" },
          { action: 'Click the "Log In" button', expectedObservation: "" },
        ],
        expectedResult: "The customer lands on /home",
        rationale: "The primary path.",
        testData: [],
        ...overrides,
      },
    ],
  });
}

const suggestion = (overrides = {}) => ({
  id: "TC-001",
  diagnosis: "The button is labelled Login, not Log In.",
  verdict: "test_is_wrong",
  confidence: "high",
  steps: [
    { action: "Navigate to /login", expectedObservation: "" },
    { action: 'Click the "Login" button', expectedObservation: "" },
  ],
  expectedResult: "The customer lands on /home",
  ...overrides,
});

describe("deriveTarget", () => {
  it("finds the page a UI case navigates to", () => {
    expect(deriveTarget("ui", planWith({}).testCases[0])).toEqual({ kind: "page", path: "/login" });
  });

  it("finds the request an API case makes, with its body", () => {
    const testCase = planWith({
      steps: [{ action: 'Send POST /posts with body {"userId":1}', expectedObservation: "" }],
    }).testCases[0];
    expect(deriveTarget("api", testCase)).toEqual({
      kind: "api",
      method: "POST",
      path: "/posts",
      body: { userId: 1 },
    });
  });

  it("returns null when there is nothing probeable", () => {
    const testCase = planWith({ steps: [{ action: "Think carefully", expectedObservation: "" }] })
      .testCases[0];
    expect(deriveTarget("ui", testCase)).toBeNull();
    expect(deriveTarget("api", testCase)).toBeNull();
  });

  it("ignores an unparseable body rather than passing junk to the probe", () => {
    const testCase = planWith({
      steps: [{ action: "Send POST /posts with body title=x", expectedObservation: "" }],
    }).testCases[0];
    expect(deriveTarget("api", testCase).body).toBeNull();
  });
});

describe("resolveUrl", () => {
  it("joins without doubling or dropping slashes", () => {
    expect(resolveUrl("https://x.test", "/a")).toBe("https://x.test/a");
    expect(resolveUrl("https://x.test/", "/a")).toBe("https://x.test/a");
    expect(resolveUrl("https://x.test", "a")).toBe("https://x.test/a");
  });
});

describe("parseUiIntent", () => {
  it("parses the same phrasings the code generator compiles", () => {
    expect(parseUiIntent("Navigate to /login")).toMatchObject({ kind: "goto", path: "/login" });
    expect(parseUiIntent('Type "a@b.co" into the Email field')).toMatchObject({
      kind: "fill",
      field: "Email",
      value: "a@b.co",
    });
    expect(parseUiIntent('Click the "Login" button')).toMatchObject({
      kind: "clickRole",
      role: "button",
      name: "Login",
    });
  });

  it("returns null for prose it does not recognise", () => {
    expect(parseUiIntent("Ponder the form")).toBeNull();
  });
});

describe("applySuggestions", () => {
  const plan = planWith({});

  it("applies a confident repair and revalidates the result", () => {
    const { plan: repaired, decisions } = applySuggestions(plan, [suggestion()]);
    expect(decisions[0].applied).toBe(true);
    expect(repaired.testCases[0].steps[1].action).toBe('Click the "Login" button');
  });

  it("never rewrites a case the model called an application defect", () => {
    // Healing a real bug out of the suite is the failure mode this whole
    // feature has to avoid.
    const { plan: repaired, decisions } = applySuggestions(plan, [
      suggestion({ verdict: "application_is_wrong" }),
    ]);
    expect(decisions[0].applied).toBe(false);
    expect(decisions[0].reason).toMatch(/defect/);
    expect(repaired.testCases[0].steps[1].action).toBe('Click the "Log In" button');
  });

  it("declines an inconclusive diagnosis", () => {
    const { decisions } = applySuggestions(plan, [suggestion({ verdict: "unclear" })]);
    expect(decisions[0].applied).toBe(false);
  });

  it("respects the confidence floor", () => {
    const low = suggestion({ confidence: "low" });
    expect(applySuggestions(plan, [low]).decisions[0].applied).toBe(false);
    expect(applySuggestions(plan, [low], { minConfidence: "low" }).decisions[0].applied).toBe(true);
  });

  it("leaves cases with no suggestion untouched", () => {
    const { plan: repaired, decisions } = applySuggestions(plan, []);
    expect(decisions).toHaveLength(0);
    expect(repaired.testCases[0]).toEqual(plan.testCases[0]);
  });

  it("rejects a repair that would not survive schema validation", () => {
    expect(() => applySuggestions(plan, [suggestion({ expectedResult: null })])).toThrow();
  });
});

describe("diffCase", () => {
  it("reports only what changed", () => {
    const changes = diffCase(planWith({}).testCases[0], suggestion());
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      before: 'Click the "Log In" button',
      after: 'Click the "Login" button',
    });
  });

  it("notices a changed expected result", () => {
    const changes = diffCase(planWith({}).testCases[0], suggestion({ expectedResult: "Something else" }));
    expect(changes.some((change) => change.after === "Something else")).toBe(true);
  });

  it("describes an added and a removed step", () => {
    const added = suggestion({
      steps: [...suggestion().steps, { action: "Navigate to /extra", expectedObservation: "" }],
    });
    expect(diffCase(planWith({}).testCases[0], added).some((c) => c.before === "(no step)")).toBe(true);

    const removed = suggestion({ steps: [suggestion().steps[0]] });
    expect(diffCase(planWith({}).testCases[0], removed).some((c) => c.after === "(removed)")).toBe(true);
  });
});

describe("renderDecisions", () => {
  const plan = planWith({});

  it("shows the diagnosis and the diff for an applied repair", () => {
    const { decisions } = applySuggestions(plan, [suggestion()]);
    const text = renderDecisions(plan, decisions);
    expect(text).toContain("The button is labelled Login, not Log In.");
    expect(text).toContain('- Click the "Log In" button');
    expect(text).toContain('+ Click the "Login" button');
  });

  it("says why a suggestion was not applied", () => {
    const { decisions } = applySuggestions(plan, [suggestion({ verdict: "application_is_wrong" })]);
    const text = renderDecisions(plan, decisions);
    expect(text).toContain("suspected defect");
    expect(text).toContain("Not applied");
  });
});

describe("renderObservation", () => {
  it("renders a page observation with the replay log", () => {
    const text = renderObservation({
      title: "Swag Labs",
      url: "https://x.test/",
      elements: [
        { role: "button", name: "Login", testId: "login-button", id: "", placeholder: "" },
      ],
      messages: ["Epic sadface: wrong credentials"],
      replay: [
        { step: 1, action: "Navigate to /", outcome: "ok" },
        { step: 2, action: 'Click the "Log In" button', outcome: "failed: Timeout" },
      ],
    });

    expect(text).toContain("Page: Swag Labs");
    expect(text).toContain('role=button name="Login"');
    expect(text).toContain('2. Click the "Log In" button — failed: Timeout');
    expect(text).toContain("Epic sadface: wrong credentials");
  });

  it("renders an API observation", () => {
    const text = renderObservation({
      request: "GET /posts/1",
      status: 404,
      contentType: "application/json",
      keys: ["userId", "id"],
      preview: "{}",
    });

    expect(text).toContain("Actual status: 404");
    expect(text).toContain("Body fields: userId, id");
  });

  it("says so when a response is not JSON", () => {
    const text = renderObservation({
      request: "GET /",
      status: 200,
      contentType: "text/html",
      keys: [],
      preview: "<html>",
    });
    expect(text).toContain("Body is not JSON");
  });
});

describe("healCase", () => {
  const testCase = planWith({}).testCases[0];

  function fakeClient(response) {
    const calls = [];
    return {
      calls,
      messages: {
        async parse(request) {
          calls.push(request);
          return {
            stop_reason: "end_turn",
            parsed_output: {
              diagnosis: "d",
              verdict: "test_is_wrong",
              confidence: "high",
              steps: testCase.steps,
              expectedResult: testCase.expectedResult,
            },
            usage: { input_tokens: 1, output_tokens: 2 },
            ...response,
          };
        },
      },
    };
  }

  it("returns a suggestion tagged with the case id", async () => {
    const client = fakeClient();
    const { suggestion: result } = await healCase({
      testCase,
      error: "boom",
      observation: "obs",
      mode: "ui",
      client,
    });
    expect(result.id).toBe("TC-001");
    expect(result.verdict).toBe("test_is_wrong");
  });

  it("sends the error, the observation and the compilable shapes", async () => {
    const client = fakeClient();
    await healCase({ testCase, error: "locator timeout", observation: "role=button", mode: "ui", client });

    const [request] = client.calls;
    const prompt = request.messages[0].content;
    expect(prompt).toContain("locator timeout");
    expect(prompt).toContain("role=button");
    expect(prompt).toContain("Navigate to /path");
    expect(request.output_config.format.type).toBe("json_schema");
  });

  it("sends API shapes in API mode", async () => {
    const client = fakeClient();
    await healCase({ testCase, error: "e", observation: "o", mode: "api", client });
    expect(client.calls[0].messages[0].content).toContain("Send POST /path with body");
  });

  it("reports a refusal rather than returning empty content", async () => {
    const client = fakeClient({ stop_reason: "refusal", parsed_output: null });
    await expect(
      healCase({ testCase, error: "e", observation: "o", mode: "ui", client }),
    ).rejects.toThrow(GenerationError);
  });

  it("reports a schema mismatch", async () => {
    const client = fakeClient({ parsed_output: null });
    await expect(
      healCase({ testCase, error: "e", observation: "o", mode: "ui", client }),
    ).rejects.toThrow(/schema/i);
  });
});
