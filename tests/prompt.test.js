import { describe, it, expect } from "vitest";

import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  API_SYSTEM_PROMPT,
  buildApiUserPrompt,
} from "../src/generator/promptTemplates.js";
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
