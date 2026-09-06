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

const UI_ACTION_RULES = [
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

const UI_OBSERVATION_RULES = [
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
 * API rules. The prompt in promptTemplates.js teaches the model exactly these
 * phrasings — the two files are a matched pair, and changing one without the
 * other shows up immediately as a drop in the translated-step percentage.
 *
 * Generated API specs assign every request to a single `response` binding that
 * the code generator declares once per test, so a case can make several calls
 * without the rules needing to track how many came before.
 */
const API_METHODS = {
  GET: "get",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
  HEAD: "head",
};

/** Renders a JSON body as a JS object literal, or null if it is not valid JSON. */
function bodyLiteral(raw) {
  const text = String(raw).trim().replace(/[.,;]+$/, "");
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return null;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

/** Renders a JSON scalar from prose: "text", 42, true. */
function scalarLiteral(raw) {
  const text = String(raw).trim().replace(/[.,;]+$/, "");
  if (/^"[^"]*"$/.test(text)) return quote(text.slice(1, -1));
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  if (/^(?:true|false|null)$/i.test(text)) return text.toLowerCase();
  return quote(text);
}

const API_ACTION_RULES = [
  {
    name: "sendWithBody",
    pattern: /^send\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)\s+with\s+body\s+(.+)$/i,
    build: (match) => {
      const method = API_METHODS[match[1].toUpperCase()];
      const body = bodyLiteral(match[3]);
      // An unparseable body is not something to guess at — fall through to
      // unresolved so the test is flagged rather than silently wrong.
      if (!method || !body) return null;
      return [`response = await request.${method}(${quote(match[2])}, { data: ${body} });`];
    },
  },
  {
    name: "send",
    pattern: /^send\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)\s*$/i,
    build: (match) => {
      const method = API_METHODS[match[1].toUpperCase()];
      if (!method) return null;
      return [`response = await request.${method}(${quote(match[2])});`];
    },
  },
];

const API_OBSERVATION_RULES = [
  {
    name: "status",
    pattern: /\bresponse\s+status\s+(?:code\s+)?(?:is|should\s+be|equals)\s+(\d{3})\b/i,
    build: (match) => [`expect(response.status()).toBe(${match[1]});`],
  },
  {
    name: "ok",
    pattern: /\bresponse\s+(?:is|should\s+be)\s+(?:successful|ok)\b/i,
    build: () => ["expect(response.ok()).toBeTruthy();"],
  },
  {
    name: "fieldEquals",
    pattern: /\bfield\s+"([^"]+)"\s+(?:is\s+)?equal\s+to\s+("[^"]*"|\S+)/i,
    build: (match) => [
      `expect(await response.json()).toHaveProperty(${quote(match[1])}, ${scalarLiteral(match[2])});`,
    ],
  },
  {
    name: "hasField",
    pattern: /\bbody\s+has\s+(?:an?\s+)?"([^"]+)"\s+field\b/i,
    build: (match) => [`expect(await response.json()).toHaveProperty(${quote(match[1])});`],
  },
  {
    name: "isArray",
    pattern: /\bbody\s+is\s+an\s+array\b/i,
    build: () => ["expect(Array.isArray(await response.json())).toBe(true);"],
  },
  {
    name: "arrayNotEmpty",
    pattern: /\barray\s+is\s+not\s+empty\b/i,
    build: () => ["expect((await response.json()).length).toBeGreaterThan(0);"],
  },
  {
    name: "bodyNotContains",
    // Security cases usually assert an absence: no password hash, no internal id.
    pattern: /\bbody\s+does\s+not\s+contain\s+"([^"]+)"/i,
    build: (match) => [`expect(await response.text()).not.toContain(${quote(match[1])});`],
  },
  {
    name: "bodyContains",
    pattern: /\bbody\s+contains\s+"([^"]+)"/i,
    build: (match) => [`expect(await response.text()).toContain(${quote(match[1])});`],
  },
];

const RULES = {
  ui: { actions: UI_ACTION_RULES, observations: UI_OBSERVATION_RULES },
  api: { actions: API_ACTION_RULES, observations: API_OBSERVATION_RULES },
};

/** The two spec styles the translator can target. */
export const MODES = Object.keys(RULES);

function rulesFor(mode) {
  const set = RULES[mode];
  if (!set) throw new Error(`Unknown translation mode: ${mode}`);
  return set;
}

/**
 * @param {string} action
 * @param {'ui'|'api'} [mode]
 * @returns {{resolved: boolean, statements: string[], rule: string}}
 */
export function translateAction(action, mode = "ui") {
  return applyRules(rulesFor(mode).actions, action);
}

/**
 * Observations are optional: an empty one is not a failure to translate,
 * it just means the step had nothing to assert.
 * @param {string} observation
 * @param {'ui'|'api'} [mode]
 */
export function translateObservation(observation, mode = "ui") {
  if (!observation?.trim()) {
    return { resolved: true, statements: [], rule: "empty" };
  }
  // One sentence often states two checkable things ("shows the error AND stays
  // on /sign-in"), so collect every rule that fires rather than stopping at the
  // first. Duplicate statements are dropped.
  const subject = observation.trim();
  const statements = [];
  const rules = [];
  for (const rule of rulesFor(mode).observations) {
    const match = subject.match(rule.pattern);
    if (!match) continue;
    for (const statement of rule.build(match) ?? []) {
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
    if (!match) continue;
    // build() returns null when the rule matched the shape but not the
    // content — an unparseable JSON body, say. That is a decline, not a match.
    const statements = rule.build(match);
    if (statements) {
      return { resolved: true, statements, rule: rule.name };
    }
  }
  return { resolved: false, statements: [], rule: "none" };
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Exposed so tests and docs can report what phrasings are understood. */
export const SUPPORTED_ACTIONS = Object.fromEntries(
  Object.entries(RULES).map(([mode, set]) => [mode, set.actions.map((rule) => rule.name)]),
);
export const SUPPORTED_OBSERVATIONS = Object.fromEntries(
  Object.entries(RULES).map(([mode, set]) => [mode, set.observations.map((rule) => rule.name)]),
);
