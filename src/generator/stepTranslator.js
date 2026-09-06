/**
 * Turns the natural-language steps of a test case into Playwright statements.
 *
 * This is deliberately a set of explicit rules rather than a second model call:
 * it is free, instant, deterministic, and unit-testable offline. The cost is
 * that it only understands the phrasings it knows about — so the important part
 * of the design is what happens when it does NOT understand a step. It never
 * guesses. An unrecognised step comes back `resolved: false`, the code
 * generator marks the whole test `test.fixme`, and the run reports it as
 * needing work rather than as a passing test that never actually checked
 * anything.
 */

/** Renders a JS string literal, escaping quotes and backslashes. */
export function quote(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Renders a regex literal for a loose URL match. */
function urlPattern(value) {
  // Prose ends in punctuation; "/sign-in." must not become part of the pattern.
  const cleaned = String(value).replace(/[.,;:!?)]+$/, "");
  // The forward slash matters: without it "/sign-in" renders as //sign-in/,
  // which JavaScript reads as a line comment rather than a regex literal.
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return `/${escaped}/`;
}

const ACTION_RULES = [
  {
    name: "navigate",
    pattern: /^(?:navigate|go|browse)\s+to\s+(\S+)/i,
    build: (match) => [`await page.goto(${quote(match[1])});`],
  },
  {
    name: "fill",
    // Only fires when the value is quoted: "type a 7-character password" is
    // genuinely ambiguous and should stay unresolved rather than be invented.
    pattern:
      /^(?:type|enter|input|fill(?:\s+in)?)\s+"([^"]*)"\s+(?:in|into)\s+the\s+(.+?)\s+(?:field|input|box)\b/i,
    build: (match) => [`await field(page, ${quote(match[2])}).fill(${quote(match[1])});`],
  },
  {
    name: "clearField",
    pattern: /^clear\s+the\s+(.+?)\s+(?:field|input|box)\b/i,
    build: (match) => [`await field(page, ${quote(match[1])}).clear();`],
  },
  {
    name: "clickButton",
    pattern: /^click\s+(?:on\s+)?the\s+"([^"]+)"\s+button\b/i,
    build: (match) => [`await page.getByRole('button', { name: ${quote(match[1])} }).click();`],
  },
  {
    name: "clickLink",
    pattern: /^click\s+(?:on\s+)?the\s+"([^"]+)"\s+link\b/i,
    build: (match) => [`await page.getByRole('link', { name: ${quote(match[1])} }).click();`],
  },
  {
    name: "clickNamed",
    pattern: /^click\s+(?:on\s+)?"([^"]+)"/i,
    build: (match) => [`await clickable(page, ${quote(match[1])}).click();`],
  },
  {
    name: "check",
    pattern: /^(?:check|tick)\s+the\s+"([^"]+)"\s+(?:checkbox|box)\b/i,
    build: (match) => [`await field(page, ${quote(match[1])}).check();`],
  },
  {
    name: "uncheck",
    pattern: /^un(?:check|tick)\s+the\s+"([^"]+)"\s+(?:checkbox|box)\b/i,
    build: (match) => [`await field(page, ${quote(match[1])}).uncheck();`],
  },
  {
    name: "select",
    pattern: /^(?:select|choose)\s+"([^"]+)"\s+from\s+the\s+(.+?)\s+(?:dropdown|select|menu|list)\b/i,
    build: (match) => [`await field(page, ${quote(match[2])}).selectOption(${quote(match[1])});`],
  },
  {
    name: "press",
    pattern: /^press\s+(?:the\s+)?"?([A-Za-z]+)"?\s*(?:key)?$/i,
    build: (match) => [`await page.keyboard.press(${quote(capitalize(match[1]))});`],
  },
];

const OBSERVATION_RULES = [
  {
    name: "urlIs",
    pattern: /\b(?:URL|url)\s+is\s+(?:still\s+)?(\/\S*)/i,
    build: (match) => [`await expect(page).toHaveURL(${urlPattern(match[1])});`],
  },
  {
    name: "navigatesAway",
    pattern: /\bnavigat\w*\s+away\s+from\s+(\/\S*)/i,
    build: (match) => [`await expect(page).not.toHaveURL(${urlPattern(match[1])});`],
  },
  {
    name: "landsOn",
    pattern: /\b(?:lands?|land|navigates?|redirect(?:s|ed)?)\s+(?:on|to)\s+(\/\S*)/i,
    build: (match) => [`await expect(page).toHaveURL(${urlPattern(match[1])});`],
  },
  {
    name: "isOn",
    pattern: /\bis\s+(?:now\s+)?on\s+(\/\S*)/i,
    build: (match) => [`await expect(page).toHaveURL(${urlPattern(match[1])});`],
  },
  {
    name: "fieldVisible",
    pattern: /\bthe\s+([A-Z][\w ]*?)\s+field\s+is\s+(?:visible|shown|displayed)/,
    build: (match) => [`await expect(field(page, ${quote(match[1].trim())})).toBeVisible();`],
  },
  {
    name: "buttonVisible",
    pattern: /\bthe\s+"([^"]+)"\s+button\s+is\s+(?:visible|shown|displayed|enabled)/i,
    build: (match) => [
      `await expect(page.getByRole('button', { name: ${quote(match[1])} }).first()).toBeVisible();`,
    ],
  },
  {
    name: "quotedVisible",
    pattern: /"([^"]+)"\s+(?:is|are)\s+(?:visible|shown|displayed|present)/i,
    build: (match) => [`await expect(page.getByText(${quote(match[1])}).first()).toBeVisible();`],
  },
  {
    name: "quotedMessage",
    pattern: /(?:message|error|text|heading|label)\b[^"]*"([^"]+)"/i,
    build: (match) => [`await expect(page.getByText(${quote(match[1])}).first()).toBeVisible();`],
  },
  {
    name: "quotedFallback",
    pattern: /^"([^"]+)"/,
    build: (match) => [`await expect(page.getByText(${quote(match[1])}).first()).toBeVisible();`],
  },
];

/**
 * @param {string} action
 * @returns {{resolved: boolean, statements: string[], rule: string}}
 */
export function translateAction(action) {
  return applyRules(ACTION_RULES, action);
}

/**
 * Observations are optional: an empty one is not a failure to translate,
 * it just means the step had nothing to assert.
 * @param {string} observation
 */
export function translateObservation(observation) {
  if (!observation?.trim()) {
    return { resolved: true, statements: [], rule: "empty" };
  }
  // One sentence often states two checkable things ("shows the error AND stays
  // on /sign-in"), so collect every rule that fires rather than stopping at the
  // first. Duplicate statements are dropped.
  const subject = observation.trim();
  const statements = [];
  const rules = [];
  for (const rule of OBSERVATION_RULES) {
    const match = subject.match(rule.pattern);
    if (!match) continue;
    for (const statement of rule.build(match)) {
      if (!statements.includes(statement)) {
        statements.push(statement);
        if (!rules.includes(rule.name)) rules.push(rule.name);
      }
    }
  }
  return {
    resolved: statements.length > 0,
    statements,
    rule: rules.join("+") || "none",
  };
}

function applyRules(rules, text) {
  const subject = text.trim();
  for (const rule of rules) {
    const match = subject.match(rule.pattern);
    if (match) {
      return { resolved: true, statements: rule.build(match), rule: rule.name };
    }
  }
  return { resolved: false, statements: [], rule: "none" };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Exposed so tests and docs can report what phrasings are understood. */
export const SUPPORTED_ACTIONS = ACTION_RULES.map((rule) => rule.name);
export const SUPPORTED_OBSERVATIONS = OBSERVATION_RULES.map((rule) => rule.name);
