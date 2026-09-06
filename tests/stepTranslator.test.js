import { describe, it, expect } from "vitest";

import { translateAction, translateObservation, quote } from "../src/generator/stepTranslator.js";

describe("translateAction", () => {
  const cases = [
    ["Navigate to /sign-in", "await page.goto('/sign-in');"],
    ['Type "ada@example.com" into the Email field', "await field(page, 'Email').fill('ada@example.com');"],
    ['Click the "Sign in" button', "await page.getByRole('button', { name: 'Sign in' }).click();"],
    ['Click the "Forgot password" link', "await page.getByRole('link', { name: 'Forgot password' }).click();"],
    ['Check the "Remember me" checkbox', "await field(page, 'Remember me').check();"],
    ['Select "Canada" from the Country dropdown', "await field(page, 'Country').selectOption('Canada');"],
  ];

  it.each(cases)("translates %s", (action, expected) => {
    const result = translateAction(action);
    expect(result.resolved).toBe(true);
    expect(result.statements).toEqual([expected]);
  });

  it("is case insensitive", () => {
    expect(translateAction("NAVIGATE TO /home").statements).toEqual(["await page.goto('/home');"]);
  });

  it("refuses to guess when the value is not quoted", () => {
    // "a 7-character password" has no literal value — inventing one would
    // produce a test that silently checks the wrong thing.
    const result = translateAction("Type a 7-character password into the Password field");
    expect(result.resolved).toBe(false);
    expect(result.statements).toEqual([]);
  });

  it("leaves prose it does not understand unresolved", () => {
    expect(translateAction("Verify the audit log was written").resolved).toBe(false);
  });
});

describe("translateObservation", () => {
  it("treats an empty observation as nothing to assert, not a failure", () => {
    const result = translateObservation("");
    expect(result.resolved).toBe(true);
    expect(result.statements).toEqual([]);
  });

  it("asserts on a URL", () => {
    expect(translateObservation("The customer lands on /account").statements).toEqual([
      "await expect(page).toHaveURL(/\\/account/);",
    ]);
  });

  it("escapes the forward slash so the regex is not read as a comment", () => {
    // //account/ would be a line comment and would break the generated file.
    const [statement] = translateObservation("The customer lands on /account").statements;
    expect(statement).not.toContain("(//");
  });

  it("strips trailing punctuation from a URL", () => {
    expect(translateObservation("the URL is still /sign-in.").statements).toEqual([
      "await expect(page).toHaveURL(/\\/sign-in/);",
    ]);
  });

  it("negates when the page should leave a URL", () => {
    expect(translateObservation("The browser navigates away from /sign-in").statements).toEqual([
      "await expect(page).not.toHaveURL(/\\/sign-in/);",
    ]);
  });

  it("collects every assertion a sentence supports, not just the first", () => {
    const result = translateObservation(
      'The message "Email or password is incorrect" is shown and the URL is still /sign-in.',
    );
    expect(result.statements).toHaveLength(2);
    expect(result.statements.some((s) => s.includes("toHaveURL"))).toBe(true);
    expect(result.statements.some((s) => s.includes("getByText"))).toBe(true);
  });

  it("does not emit the same assertion twice when two rules match", () => {
    const result = translateObservation('The error message "Nope" is visible');
    expect(new Set(result.statements).size).toBe(result.statements.length);
  });

  it("guards text assertions against Playwright strict mode", () => {
    const [statement] = translateObservation('The heading "Products" is visible').statements;
    expect(statement).toContain(".first()");
  });
});

describe("quote", () => {
  it("escapes quotes and backslashes", () => {
    expect(quote("it's")).toBe("'it\\'s'");
    expect(quote("a\\b")).toBe("'a\\\\b'");
  });
});

describe("API mode", () => {
  it("translates a request with no body", () => {
    expect(translateAction("Send GET /posts/1", "api").statements).toEqual([
      "response = await request.get('/posts/1');",
    ]);
  });

  it("translates every documented method", () => {
    for (const [method, call] of [
      ["GET", "get"],
      ["POST", "post"],
      ["PUT", "put"],
      ["PATCH", "patch"],
      ["DELETE", "delete"],
      ["HEAD", "head"],
    ]) {
      const [statement] = translateAction(`Send ${method} /posts/1`, "api").statements;
      expect(statement).toContain(`request.${call}(`);
    }
  });

  it("translates a request with a JSON body", () => {
    expect(translateAction('Send POST /posts with body {"userId":1}', "api").statements).toEqual([
      'response = await request.post(\'/posts\', { data: {"userId":1} });',
    ]);
  });

  it("declines a body that is not valid JSON rather than emitting broken code", () => {
    const result = translateAction("Send POST /posts with body title=hello", "api");
    expect(result.resolved).toBe(false);
    expect(result.statements).toEqual([]);
  });

  it("declines a body that is a bare scalar", () => {
    expect(translateAction('Send POST /posts with body "hello"', "api").resolved).toBe(false);
  });

  it("asserts on status codes", () => {
    expect(translateObservation("The response status is 404", "api").statements).toEqual([
      "expect(response.status()).toBe(404);",
    ]);
  });

  it("asserts on a field with a string value", () => {
    expect(
      translateObservation('The response body has field "title" equal to "generated"', "api").statements,
    ).toEqual(["expect(await response.json()).toHaveProperty('title', 'generated');"]);
  });

  it("keeps a numeric field value numeric", () => {
    const [statement] = translateObservation(
      'The response body has field "userId" equal to 1',
      "api",
    ).statements;
    expect(statement).toContain("toHaveProperty('userId', 1)");
    expect(statement).not.toContain("'1'");
  });

  it("asserts an absence for security cases", () => {
    expect(
      translateObservation('The response body does not contain "password"', "api").statements,
    ).toEqual(["expect(await response.text()).not.toContain('password');"]);
  });

  it("does not confuse 'does not contain' with 'contains'", () => {
    const result = translateObservation('The response body does not contain "password"', "api");
    expect(result.statements.some((s) => s.includes(".not.toContain"))).toBe(true);
    expect(result.statements.some((s) => /[^t]\.toContain/.test(s))).toBe(false);
  });

  it("collects two assertions from one combined sentence", () => {
    const result = translateObservation(
      "The response status is 200 and the response body is an array",
      "api",
    );
    expect(result.statements).toHaveLength(2);
  });

  it("does not apply UI rules in API mode, or the reverse", () => {
    expect(translateAction("Navigate to /posts", "api").resolved).toBe(false);
    expect(translateAction("Send GET /posts", "ui").resolved).toBe(false);
  });

  it("rejects an unknown mode loudly", () => {
    expect(() => translateAction("Send GET /posts", "graphql")).toThrow(/unknown translation mode/i);
  });
});
