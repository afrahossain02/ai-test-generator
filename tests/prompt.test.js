import { describe, it, expect } from "vitest";

import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  API_SYSTEM_PROMPT,
  buildApiUserPrompt,
  buildHealPrompt,
  UI_STEP_PHRASINGS,
  API_STEP_PHRASINGS,
} from "../src/generator/promptTemplates.js";
import { translateAction, translateObservation } from "../src/generator/stepTranslator.js";
import { CATEGORIES } from "../src/generator/schema.js";

describe("prompts", () => {
  it("names every category the schema allows", () => {
    for (const category of CATEGORIES) {
      expect(SYSTEM_PROMPT).toContain(category);
    }
  });

  it("carries the story text through untouched", () => {
    const story = "As a customer I want to reset my password";
    expect(buildUserPrompt(story, 5)).toContain(story);
  });

  it("trims surrounding whitespace so indentation doesn't leak into the prompt", () => {
    expect(buildUserPrompt("\n\n  story  \n\n", 5)).toContain("<user_story>\nstory\n</user_story>");
  });

  it("asks for the requested number of cases", () => {
    expect(buildUserPrompt("story", 12)).toContain("12 test cases");
  });
});

describe("API prompts", () => {
  const spec = {
    title: "Posts API",
    servers: ["https://api.example.com"],
  };

  it("teaches exactly the phrasings the API rules can compile", () => {
    // If these drift apart, the model writes steps the translator cannot read
    // and every test lands as fixme. Keep them in step.
    for (const phrasing of [
      "Send GET /path",
      "Send POST /path with body",
      "The response status is 200",
      "The response body is an array",
      'The response body has field "title" equal to',
      "The response body does not contain",
    ]) {
      expect(API_SYSTEM_PROMPT).toContain(phrasing);
    }
  });

  it("forbids leaving path placeholders unsubstituted", () => {
    expect(API_SYSTEM_PROMPT).toContain("never");
    expect(API_SYSTEM_PROMPT).toContain("/posts/{id}");
  });

  it("names every category the schema allows", () => {
    for (const category of CATEGORIES) {
      expect(API_SYSTEM_PROMPT).toContain(category);
    }
  });

  it("carries the endpoint block and the server through", () => {
    const prompt = buildApiUserPrompt(spec, "GET /posts — List all posts", 8);
    expect(prompt).toContain("GET /posts — List all posts");
    expect(prompt).toContain('server="https://api.example.com"');
    expect(prompt).toContain("8 test cases");
  });

  it("survives a spec with no declared server", () => {
    const prompt = buildApiUserPrompt({ title: "X", servers: [] }, "GET /a", 3);
    expect(prompt).not.toContain("server=");
    expect(prompt).toContain('<api title="X">');
  });
});

describe("the phrasing contract", () => {
  // The prompts and the translator rules are a matched pair. If a rule exists
  // that no prompt teaches, the model never emits it and the rule is dead
  // code; if a prompt teaches a shape no rule compiles, every case using it
  // lands as test.fixme. These assertions are what keep them together.
  it("teaches a UI phrasing that each UI action rule can actually compile", () => {
    for (const line of actionLines(UI_STEP_PHRASINGS)) {
      expect(translateAction(line, "ui").resolved, `UI prompt teaches "${line}" but no rule compiles it`).toBe(true);
    }
  });

  it("teaches a UI observation that each UI rule can compile", () => {
    for (const line of observationLines(UI_STEP_PHRASINGS)) {
      expect(translateObservation(line, "ui").resolved, `UI prompt teaches "${line}" but no rule compiles it`).toBe(true);
    }
  });

  it("teaches an API phrasing that each API action rule can compile", () => {
    for (const line of actionLines(API_STEP_PHRASINGS)) {
      expect(translateAction(line, "api").resolved, `API prompt teaches "${line}" but no rule compiles it`).toBe(true);
    }
  });

  it("teaches an API observation that each API rule can compile", () => {
    for (const line of observationLines(API_STEP_PHRASINGS)) {
      expect(translateObservation(line, "api").resolved, `API prompt teaches "${line}" but no rule compiles it`).toBe(true);
    }
  });

  it("is reachable from both generator prompts and the healer prompt", () => {
    expect(SYSTEM_PROMPT).toContain(UI_STEP_PHRASINGS);
    expect(API_SYSTEM_PROMPT).toContain(API_STEP_PHRASINGS);
    expect(buildHealPrompt("ui", healCaseFixture, "err", "obs")).toContain(UI_STEP_PHRASINGS);
    expect(buildHealPrompt("api", healCaseFixture, "err", "obs")).toContain(API_STEP_PHRASINGS);
  });
});

const healCaseFixture = {
  id: "TC-001",
  title: "T",
  category: "happy_path",
  priority: "P0",
  rationale: "r",
  preconditions: [],
  steps: [{ action: "Navigate to /", expectedObservation: "" }],
  expectedResult: "x",
};

function section(block, heading) {
  const [, body = ""] = block.split(`${heading}:`);
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.endsWith(":"))
    .filter((line) => !/^(Observations|Actions)/.test(line));
}

const actionLines = (block) => section(block.split("Observations")[0], "Actions");
const observationLines = (block) => section(block, "Observations and expected results");
