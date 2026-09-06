import fs from "node:fs";
import path from "node:path";

import { GenerationError } from "../utils/errors.js";

/**
 * Reads a Playwright JSON report and indexes each result by the generated test
 * title.
 *
 * The join key is the full title ("TC-001 · Valid credentials ..."), not the
 * case id alone. Every plan numbers its cases from TC-001, so a run covering
 * more than one plan has colliding ids — indexing by id would let a skipped UI
 * case overwrite a passing API case with the same number. Titles carry the
 * case text, so they stay distinct.
 *
 * The id index is kept as a fallback for titles that were edited after
 * generation, but only for ids that appear exactly once in the run — an
 * ambiguous id is left unresolved rather than guessed at.
 */
const CASE_ID = /^(TC-\d+)/;

export function parsePlaywrightResults(report) {
  const byTitle = new Map();
  const seenIds = new Map();

  for (const spec of collectSpecs(report)) {
    const title = String(spec.title ?? "");
    const match = title.match(CASE_ID);
    if (!match) continue;

    const status = specStatus(spec);
    // A case can run under several projects; any failure wins, because
    // "it passed somewhere" is not a useful thing to report.
    byTitle.set(title, worseOf(byTitle.get(title), status));

    const id = match[1];
    const existing = seenIds.get(id);
    seenIds.set(id, {
      status: worseOf(existing?.status, status),
      titles: new Set([...(existing?.titles ?? []), title]),
    });
  }

  // Only ids that map to a single title are safe to fall back on.
  const byId = new Map(
    [...seenIds.entries()]
      .filter(([, entry]) => entry.titles.size === 1)
      .map(([id, entry]) => [id, entry.status]),
  );

  const ambiguousIds = [...seenIds.entries()]
    .filter(([, entry]) => entry.titles.size > 1)
    .map(([id]) => id);

  return { byTitle, byId, ambiguousIds, count: byTitle.size };
}

/** Status for one plan case, or "" when the run says nothing about it. */
export function lookupStatus(results, id, title) {
  if (!results) return "";
  return results.byTitle.get(`${id} · ${title}`) ?? results.byId.get(id) ?? "";
}

export function loadPlaywrightResults(resultsPath) {
  const resolved = path.resolve(resultsPath);
  if (!fs.existsSync(resolved)) {
    throw new GenerationError(`No such file: ${resolved}`, {
      hint: "Produce one with: npx playwright test --reporter=json > results.json",
    });
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new GenerationError(`${resolved} is not valid JSON: ${error.message}`, {
      hint: "Check the file is a Playwright JSON report, not the list reporter's text output.",
    });
  }

  if (!report || typeof report !== "object" || !Array.isArray(report.suites)) {
    throw new GenerationError(`${resolved} is not a Playwright JSON report.`, {
      hint: "It needs a top-level 'suites' array. Generate it with --reporter=json.",
    });
  }

  return parsePlaywrightResults(report);
}

/** Playwright nests suites arbitrarily deep; flatten to the specs. */
function collectSpecs(node, found = []) {
  if (!node || typeof node !== "object") return found;
  for (const spec of node.specs ?? []) found.push(spec);
  for (const suite of node.suites ?? []) collectSpecs(suite, found);
  return found;
}

function specStatus(spec) {
  const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
  if (results.length === 0) return "unknown";

  if (results.some((result) => result.status === "failed" || result.status === "timedOut")) {
    return "failed";
  }
  // Playwright reports a test.fixme as skipped; that is the generator saying
  // the case was left unfinished, not that the run was incomplete.
  if (results.every((result) => result.status === "skipped")) return "skipped";
  if (results.some((result) => result.status === "passed")) return "passed";
  return "unknown";
}

const SEVERITY = { failed: 3, unknown: 2, skipped: 1, passed: 0 };

function worseOf(a, b) {
  if (!a) return b;
  return (SEVERITY[b] ?? 0) > (SEVERITY[a] ?? 0) ? b : a;
}
