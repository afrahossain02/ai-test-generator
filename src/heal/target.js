/**
 * Works out what a failing case was actually talking to, so the probe knows
 * where to look. Reads the case's own steps rather than the generated file,
 * because the plan is the source of truth.
 */
const NAVIGATE = /^(?:navigate|go|browse)\s+to\s+(\S+)/i;
const SEND = /^send\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)(?:\s+with\s+body\s+(.+))?$/i;

export function deriveTarget(mode, testCase) {
  if (mode === "api") {
    for (const step of testCase.steps) {
      const match = step.action.trim().match(SEND);
      if (match) {
        return {
          kind: "api",
          method: match[1].toUpperCase(),
          path: match[2],
          body: parseBody(match[3]),
        };
      }
    }
    return null;
  }

  for (const step of testCase.steps) {
    const match = step.action.trim().match(NAVIGATE);
    if (match) return { kind: "page", path: match[1] };
  }
  return null;
}

function parseBody(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw).trim().replace(/[.,;]+$/, ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Joins a base URL with a case's path, tolerating slashes on either side. */
export function resolveUrl(baseUrl, routePath) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(routePath).replace(/^\/+/, "")}`;
}
