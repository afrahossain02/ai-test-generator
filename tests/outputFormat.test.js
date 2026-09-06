import { describe, it, expect } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { ModelOutputSchema } from "../src/generator/schema.js";

/**
 * Guards the SDK/Zod pairing offline. The schema conversion is where a version
 * bump breaks first, and it breaks at request time — which costs a real API
 * call to discover. This catches it in the test run instead.
 */
describe("zod → strict JSON schema conversion", () => {
  const format = zodOutputFormat(ModelOutputSchema, "test_plan");

  it("produces a json_schema output format", () => {
    expect(format.type).toBe("json_schema");
  });

  it("closes every object, as strict output requires", () => {
    const objects = collect(format.schema, (node) => node?.type === "object");
    expect(objects.length).toBeGreaterThan(0);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect(object.required.sort()).toEqual(Object.keys(object.properties).sort());
    }
  });

  it("does not ask the model for sourceType or generatedAt", () => {
    const serialized = JSON.stringify(format.schema);
    expect(serialized).not.toContain("generatedAt");
    expect(serialized).not.toContain("sourceType");
  });
});

function collect(node, predicate, found = []) {
  if (node && typeof node === "object") {
    if (predicate(node)) found.push(node);
    for (const value of Object.values(node)) collect(value, predicate, found);
  }
  return found;
}
