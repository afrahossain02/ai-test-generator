import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { GenerationError } from "../utils/errors.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/**
 * Reads an OpenAPI 3 or Swagger 2 document and flattens it into the handful of
 * facts a test designer actually needs per endpoint.
 *
 * Deliberately NOT a full-fidelity parser: the output feeds a prompt, and
 * pasting a 4,000-line spec into the context window buys noise, not coverage.
 * $refs are resolved one level to a name rather than inlined for the same
 * reason — "body: Pet" tells the model what it needs to know.
 */
export function parseOpenApi(source, { filename = "spec" } = {}) {
  const document = parseDocument(source, filename);

  const version = document.openapi ?? document.swagger;
  if (!version) {
    throw new GenerationError(`${filename} is not an OpenAPI or Swagger document.`, {
      hint: "The file needs a top-level 'openapi' (3.x) or 'swagger' (2.0) version field.",
    });
  }

  const paths = document.paths ?? {};
  const operations = [];

  for (const [route, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    // Parameters can be declared once for every method on a path.
    const sharedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object") continue;

      const parameters = [...sharedParameters, ...(operation.parameters ?? [])];
      operations.push({
        method: method.toUpperCase(),
        path: route,
        operationId: operation.operationId ?? "",
        summary: operation.summary ?? operation.description ?? "",
        tags: operation.tags ?? [],
        parameters: parameters.map(describeParameter).filter(Boolean),
        requestBody: describeRequestBody(operation, document),
        responses: describeResponses(operation.responses ?? {}),
        security: describeSecurity(operation, document),
      });
    }
  }

  if (operations.length === 0) {
    throw new GenerationError(`${filename} declares no operations.`, {
      hint: "Check that the document has a 'paths' section with at least one HTTP method.",
    });
  }

  return {
    title: document.info?.title ?? filename,
    description: document.info?.description ?? "",
    version: document.info?.version ?? "",
    servers: describeServers(document),
    operations,
  };
}

/** Reads a spec from disk, choosing the parser by extension and then by content. */
export function loadOpenApiFile(specPath) {
  const resolved = path.resolve(specPath);
  if (!fs.existsSync(resolved)) {
    throw new GenerationError(`No such file: ${resolved}`, {
      hint: "Pass --spec with a path to an OpenAPI JSON or YAML file.",
    });
  }
  return parseOpenApi(fs.readFileSync(resolved, "utf8"), { filename: path.basename(resolved) });
}

function parseDocument(source, filename) {
  if (typeof source === "object" && source !== null) return source;

  const text = String(source).trim();
  if (!text) {
    throw new GenerationError(`${filename} is empty.`, { hint: "" });
  }

  try {
    // YAML is a superset of JSON, so one parser handles both — but try JSON
    // first so JSON syntax errors report as JSON errors.
    return text.startsWith("{") ? JSON.parse(text) : YAML.parse(text);
  } catch (error) {
    throw new GenerationError(`${filename} is not valid JSON or YAML: ${error.message}`, {
      hint: "Check the file opens cleanly in an editor or linter.",
    });
  }
}

function describeParameter(parameter) {
  if (!parameter || typeof parameter !== "object") return null;
  // A $ref'd parameter carries no inline detail; name it and move on.
  if (parameter.$ref) return { name: refName(parameter.$ref), in: "unknown", required: false, type: "" };

  return {
    name: parameter.name ?? "",
    in: parameter.in ?? "",
    required: Boolean(parameter.required),
    type: schemaTypeName(parameter.schema ?? parameter),
  };
}

function describeRequestBody(operation, document) {
  // OpenAPI 3 puts the body in requestBody; Swagger 2 uses an "in: body" parameter.
  const body = operation.requestBody;
  if (body) {
    if (body.$ref) return { required: false, contentType: "", schema: refName(body.$ref) };
    const [contentType, media] = Object.entries(body.content ?? {})[0] ?? [];
    return {
      required: Boolean(body.required),
      contentType: contentType ?? "",
      schema: schemaTypeName(media?.schema),
    };
  }

  const legacy = (operation.parameters ?? []).find((parameter) => parameter?.in === "body");
  if (legacy) {
    return {
      required: Boolean(legacy.required),
      contentType: document.consumes?.[0] ?? "application/json",
      schema: schemaTypeName(legacy.schema),
    };
  }

  return null;
}

function describeResponses(responses) {
  return Object.entries(responses)
    .filter(([status]) => status !== "default")
    .map(([status, response]) => ({
      status,
      description: response?.description ?? "",
    }));
}

function describeSecurity(operation, document) {
  const requirements = operation.security ?? document.security ?? [];
  const names = requirements.flatMap((requirement) => Object.keys(requirement ?? {}));
  return [...new Set(names)];
}

function describeServers(document) {
  if (Array.isArray(document.servers)) {
    return document.servers.map((server) => server?.url).filter(Boolean);
  }
  // Swagger 2 splits the server across three fields.
  if (document.host) {
    const scheme = document.schemes?.[0] ?? "https";
    return [`${scheme}://${document.host}${document.basePath ?? ""}`];
  }
  return [];
}

function schemaTypeName(schema) {
  if (!schema || typeof schema !== "object") return "";
  if (schema.$ref) return refName(schema.$ref);
  if (schema.type === "array") {
    const item = schemaTypeName(schema.items);
    return item ? `array of ${item}` : "array";
  }
  return schema.type ?? "";
}

function refName(ref) {
  return String(ref).split("/").pop() ?? "";
}

/** Human-readable "GET /pet/{petId}" used for filtering and for the prompt. */
export function operationLabel(operation) {
  return `${operation.method} ${operation.path}`;
}

/**
 * Narrows a spec to the operations matching a case-insensitive pattern
 * against "METHOD /path", the operationId, or a tag.
 */
export function filterOperations(operations, pattern) {
  if (!pattern) return operations;

  let regex;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    throw new GenerationError(`--filter is not a valid regular expression: ${pattern}`, {
      hint: 'Try something simpler, like --filter "^GET /posts".',
    });
  }

  return operations.filter(
    (operation) =>
      regex.test(operationLabel(operation)) ||
      regex.test(operation.operationId) ||
      operation.tags.some((tag) => regex.test(tag)),
  );
}

/** Compact text block describing the endpoints, for the prompt. */
export function renderOperations(operations) {
  return operations
    .map((operation) => {
      const lines = [`${operationLabel(operation)}${operation.summary ? ` — ${operation.summary}` : ""}`];

      for (const parameter of operation.parameters) {
        const bits = [parameter.in, parameter.type].filter(Boolean).join(", ");
        lines.push(
          `  param ${parameter.name}${bits ? ` (${bits})` : ""}${parameter.required ? " [required]" : ""}`,
        );
      }

      if (operation.requestBody) {
        const { contentType, schema, required } = operation.requestBody;
        lines.push(
          `  body ${[schema, contentType].filter(Boolean).join(" as ") || "unspecified"}${required ? " [required]" : ""}`,
        );
      }

      if (operation.responses.length > 0) {
        const statuses = operation.responses
          .map(({ status, description }) => (description ? `${status} ${description}` : status))
          .join("; ");
        lines.push(`  responses ${statuses}`);
      }

      if (operation.security.length > 0) {
        lines.push(`  security ${operation.security.join(", ")}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
