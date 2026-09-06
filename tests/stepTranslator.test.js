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
