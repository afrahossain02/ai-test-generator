import { describe, it, expect } from "vitest";

import { SYSTEM_PROMPT, buildUserPrompt } from "../src/generator/promptTemplates.js";
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
