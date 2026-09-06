import { chromium, request as playwrightRequest } from "playwright";

import { parseUiIntent } from "../generator/stepTranslator.js";
import { GenerationError } from "../utils/errors.js";

/**
 * Observes what is actually there, so a suggested fix can be grounded in
 * reality rather than invented.
 *
 * This is the whole point of the probe. Asking a model to repair a locator
 * from an error message alone invites a confident guess at a selector that
 * does not exist either. Handing it the real interactive elements on the page
 * turns the task from "invent a locator" into "pick the right one", which is
 * a question with a checkable answer.
 */
const MAX_ELEMENTS = 60;

export async function probePage({ url, steps = [], timeout = 15000 }) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });

    // An assertion usually fails on a state the user reached, not on the
    // landing page — the login error appears after submitting, not before. So
    // replay the case's own steps first, best-effort, and observe where that
    // lands. Steps that fail are expected: one of them is why we are here.
    const replay = await replaySteps(page, steps);

    const observed = await page.evaluate((limit) => {
      const seen = new Set();
      const elements = [];

      const accessibleName = (element) => {
        const aria = element.getAttribute("aria-label");
        if (aria) return aria.trim();
        if (element.labels?.length) return element.labels[0].textContent.trim();
        if (element.getAttribute("placeholder")) return element.getAttribute("placeholder").trim();
        if (element.tagName === "INPUT" && element.value && element.type !== "text") {
          return element.value.trim();
        }
        return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      };

      const roleOf = (element) => {
        const explicit = element.getAttribute("role");
        if (explicit) return explicit;
        const tag = element.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (/^h[1-6]$/.test(tag)) return "heading";
        if (tag === "input") {
          const type = (element.getAttribute("type") ?? "text").toLowerCase();
          if (type === "submit" || type === "button") return "button";
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          return "textbox";
        }
        return "";
      };

      const selector =
        'button, a[href], input, select, textarea, [role], h1, h2, h3, [data-testid], [data-test], [data-qa]';

      for (const element of document.querySelectorAll(selector)) {
        if (elements.length >= limit) break;
        const visible = Boolean(element.getClientRects().length);
        if (!visible) continue;

        // Record which attribute carried the test id, so a generated locator
        // map targets the convention this app actually uses.
        const testIdAttribute = ["data-testid", "data-test", "data-qa"].find((attribute) =>
          element.getAttribute(attribute),
        );

        const entry = {
          role: roleOf(element),
          name: accessibleName(element),
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type") ?? "",
          placeholder: element.getAttribute("placeholder") ?? "",
          testId: testIdAttribute ? element.getAttribute(testIdAttribute) : "",
          testIdAttribute: testIdAttribute ?? "",
          id: element.id ?? "",
        };
        if (!entry.role && !entry.name) continue;

        const key = JSON.stringify(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        elements.push(entry);
      }

      // Anything the page is currently shouting about is usually the reason
      // an assertion failed.
      const messages = [...document.querySelectorAll('[role="alert"], [class*="error"], [class*="message"]')]
        .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text && text.length < 200)
        .slice(0, 10);

      return { title: document.title, url: location.href, elements, messages: [...new Set(messages)] };
    }, MAX_ELEMENTS);

    return { ...observed, replay };
  } catch (error) {
    throw new GenerationError(`Could not load ${url}: ${error.message}`, {
      hint: "Check the URL is reachable and --base-url points at the right environment.",
    });
  } finally {
    await browser?.close();
  }
}

/**
 * Performs each recognised step against the live page, recording which
 * worked. Errors are swallowed on purpose: a step that cannot be performed is
 * evidence, not a crash.
 */
async function replaySteps(page, steps) {
  const performed = [];

  for (const [index, step] of steps.entries()) {
    const intent = parseUiIntent(step.action);
    if (!intent) {
      performed.push({ step: index + 1, action: step.action, outcome: "not understood" });
      continue;
    }

    try {
      await perform(page, intent);
      performed.push({ step: index + 1, action: step.action, outcome: "ok" });
    } catch (error) {
      performed.push({
        step: index + 1,
        action: step.action,
        outcome: `failed: ${String(error.message).split("\n")[0]}`,
      });
    }
  }

  // Let anything the last action triggered settle before we look.
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  return performed;
}

const ACTION_TIMEOUT = 4000;

function locate(page, name) {
  return page.getByLabel(name).or(page.getByPlaceholder(name)).first();
}

async function perform(page, intent) {
  switch (intent.kind) {
    case "goto":
      return page.goto(new URL(intent.path, page.url()).href, { waitUntil: "domcontentloaded" });
    case "fill":
      return locate(page, intent.field).fill(intent.value, { timeout: ACTION_TIMEOUT });
    case "clear":
      return locate(page, intent.field).clear({ timeout: ACTION_TIMEOUT });
    case "clickRole":
      return page
        .getByRole(intent.role, { name: intent.name })
        .click({ timeout: ACTION_TIMEOUT });
    case "clickAny":
      return page
        .getByRole("button", { name: intent.name })
        .or(page.getByRole("link", { name: intent.name }))
        .first()
        .click({ timeout: ACTION_TIMEOUT });
    case "check":
      return intent.checked
        ? locate(page, intent.field).check({ timeout: ACTION_TIMEOUT })
        : locate(page, intent.field).uncheck({ timeout: ACTION_TIMEOUT });
    case "select":
      return locate(page, intent.field).selectOption(intent.value, { timeout: ACTION_TIMEOUT });
    case "press":
      return page.keyboard.press(intent.key);
    default:
      throw new Error(`No replay for intent ${intent.kind}`);
  }
}

/** Re-issues an API call and reports what actually came back. */
export async function probeApi({ baseUrl, method = "GET", path: route, body, timeout = 15000 }) {
  let context;
  try {
    context = await playwrightRequest.newContext({ baseURL: baseUrl, timeout });
    const call = method.toLowerCase();
    const response = await context[call](route, body ? { data: body } : undefined);

    const text = await response.text();
    let keys = [];
    let parsed;
    try {
      parsed = JSON.parse(text);
      keys = Array.isArray(parsed)
        ? [`array of ${parsed.length}`, ...Object.keys(parsed[0] ?? {})]
        : Object.keys(parsed ?? {});
    } catch {
      keys = [];
    }

    return {
      request: `${method.toUpperCase()} ${route}`,
      status: response.status(),
      contentType: response.headers()["content-type"] ?? "",
      keys,
      preview: text.slice(0, 400),
    };
  } catch (error) {
    throw new GenerationError(`Could not call ${method} ${route}: ${error.message}`, {
      hint: "Check --base-url and that the endpoint is reachable.",
    });
  } finally {
    await context?.dispose();
  }
}

/** Renders an observation as the compact block the prompt receives. */
export function renderObservation(observed) {
  if (observed.status !== undefined) {
    return [
      `Request: ${observed.request}`,
      `Actual status: ${observed.status}`,
      `Content-Type: ${observed.contentType}`,
      observed.keys.length > 0 ? `Body fields: ${observed.keys.join(", ")}` : "Body is not JSON",
      `Body preview: ${observed.preview}`,
    ].join("\n");
  }

  const lines = [`Page: ${observed.title} (${observed.url})`];

  if (observed.replay?.length > 0) {
    lines.push("", "The case's own steps were replayed to reach this state:");
    for (const entry of observed.replay) {
      lines.push(`  ${entry.step}. ${entry.action} — ${entry.outcome}`);
    }
  }

  lines.push("", "Visible elements:");
  for (const element of observed.elements) {
    const bits = [
      element.role && `role=${element.role}`,
      element.name && `name="${element.name}"`,
      element.placeholder && `placeholder="${element.placeholder}"`,
      element.testId && `testid="${element.testId}"`,
      element.id && `id="${element.id}"`,
    ].filter(Boolean);
    lines.push(`  ${bits.join(" ")}`);
  }
  if (observed.messages.length > 0) {
    lines.push("", "Messages currently on the page:");
    for (const message of observed.messages) lines.push(`  "${message}"`);
  }
  return lines.join("\n");
}
