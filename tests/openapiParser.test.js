import fs from "node:fs";

import { describe, it, expect } from "vitest";

import {
  parseOpenApi,
  loadOpenApiFile,
  filterOperations,
  renderOperations,
  operationLabel,
} from "../src/openapi/parser.js";
import { GenerationError } from "../src/utils/errors.js";

const spec = loadOpenApiFile("examples/jsonplaceholder-openapi.yaml");

describe("parseOpenApi", () => {
  it("reads the document metadata", () => {
    expect(spec.title).toBe("JSONPlaceholder Posts API");
    expect(spec.servers).toEqual(["https://jsonplaceholder.typicode.com"]);
  });

  it("flattens every path/method pair into an operation", () => {
    const labels = spec.operations.map(operationLabel);
    expect(labels).toContain("GET /posts");
    expect(labels).toContain("POST /posts");
    expect(labels).toContain("DELETE /posts/{id}");
    expect(spec.operations).toHaveLength(7);
  });

  it("inherits path-level parameters onto each method", () => {
    // /posts/{id} declares `id` once, above get/put/delete.
    const get = spec.operations.find((o) => operationLabel(o) === "GET /posts/{id}");
    expect(get.parameters.map((p) => p.name)).toContain("id");
    const del = spec.operations.find((o) => operationLabel(o) === "DELETE /posts/{id}");
    expect(del.parameters.map((p) => p.name)).toContain("id");
  });

  it("resolves a $ref body to its schema name rather than inlining it", () => {
    const post = spec.operations.find((o) => operationLabel(o) === "POST /posts");
    expect(post.requestBody).toMatchObject({ required: true, schema: "NewPost" });
  });

  it("keeps documented response codes", () => {
    const get = spec.operations.find((o) => operationLabel(o) === "GET /posts/{id}");
    expect(get.responses.map((r) => r.status)).toEqual(["200", "404"]);
  });

  it("accepts JSON as well as YAML", () => {
    const json = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Inline" },
      paths: { "/ping": { get: { responses: { "200": { description: "pong" } } } } },
    });
    expect(parseOpenApi(json).operations).toHaveLength(1);
  });

  it("reads a Swagger 2 document, including host-based servers and body params", () => {
    const swagger = {
      swagger: "2.0",
      info: { title: "Legacy" },
      host: "api.example.com",
      basePath: "/v2",
      schemes: ["https"],
      consumes: ["application/json"],
      paths: {
        "/pet": {
          post: {
            parameters: [{ in: "body", name: "body", required: true, schema: { $ref: "#/definitions/Pet" } }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const parsed = parseOpenApi(swagger);
    expect(parsed.servers).toEqual(["https://api.example.com/v2"]);
    expect(parsed.operations[0].requestBody).toMatchObject({ schema: "Pet", required: true });
  });

  it("rejects a document that is not a spec at all", () => {
    expect(() => parseOpenApi(JSON.stringify({ hello: "world" }))).toThrow(GenerationError);
  });

  it("rejects a spec with no operations", () => {
    expect(() => parseOpenApi(JSON.stringify({ openapi: "3.0.0", paths: {} }))).toThrow(/no operations/i);
  });

  it("reports malformed YAML as a parse failure, not a crash", () => {
    expect(() => parseOpenApi("openapi: 3.0.0\n  bad: [indent")).toThrow(GenerationError);
  });

  it("reports a missing file clearly", () => {
    expect(() => loadOpenApiFile("nope.yaml")).toThrow(/No such file/);
  });
});

describe("filterOperations", () => {
  it("returns everything when no pattern is given", () => {
    expect(filterOperations(spec.operations, "")).toHaveLength(7);
  });

  it("matches on METHOD /path", () => {
    const matched = filterOperations(spec.operations, "^GET /posts$").map(operationLabel);
    expect(matched).toEqual(["GET /posts"]);
  });

  it("matches on tag and on operationId", () => {
    expect(filterOperations(spec.operations, "users").map(operationLabel)).toEqual(["GET /users/{id}"]);
    expect(filterOperations(spec.operations, "listPostComments")).toHaveLength(1);
  });

  it("is case insensitive", () => {
    expect(filterOperations(spec.operations, "get /users").length).toBe(1);
  });

  it("rejects an invalid regex with a usable message", () => {
    expect(() => filterOperations(spec.operations, "[")).toThrow(/valid regular expression/i);
  });

  it("can legitimately match nothing", () => {
    expect(filterOperations(spec.operations, "^PATCH ")).toEqual([]);
  });
});

describe("renderOperations", () => {
  const block = renderOperations(spec.operations);

  it("names each endpoint with its summary", () => {
    expect(block).toContain("GET /posts/{id} — Fetch a single post by id");
  });

  it("lists parameters, bodies and responses", () => {
    expect(block).toContain("param id (path, integer) [required]");
    expect(block).toContain("body NewPost as application/json [required]");
    expect(block).toContain("responses 200 The requested post; 404 No post with that id");
  });

  it("stays far smaller than the source document", () => {
    // The point of the summary is to keep the prompt cheap.
    const source = fs.readFileSync("examples/jsonplaceholder-openapi.yaml", "utf8");
    expect(block.length).toBeLessThan(source.length);
  });
});
