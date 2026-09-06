# ai-test-generator

Turns user stories into structured test cases and runnable Playwright specs — cutting test design time while surfacing the edge cases that get missed by hand.

> **Status: Phase 2.** The CLI generates a schema-validated test plan from a user story, then compiles that plan into Playwright `.spec.js` files that run against a real site. Next up is OpenAPI input — see the [roadmap](#roadmap).

---

## The problem

Writing a comprehensive test plan is slow, and the parts that get skipped are the parts that matter. Under deadline pressure the happy path gets covered and the boundary conditions don't — the off-by-one at the minimum password length, the lockout counter that increments but never enforces, the "no such account" message that quietly leaks which emails are registered.

Those aren't exotic bugs. They're the ones nobody had time to write a case for.

This tool takes the user story you already wrote, produces a test plan that must cover five categories — happy path, negative, edge, boundary, and security — with a stated reason for each case, and then compiles that plan into Playwright tests you can run.

## Demo

Generate the specs and run them against [saucedemo.com](https://www.saucedemo.com), a public demo storefront:

```bash
npm run test:generated
```

```
✓ Wrote generated-tests/saucedemo.spec.js
  6 tests · 5 runnable · 1 need work · 18/19 steps translated (95%) · 7 assertions

Running 6 tests using 2 workers
  ✓  TC-001 · Valid credentials land the shopper on the product catalogue (3.9s)
  ✓  TC-005 · A locked-out account is refused even with the correct password (3.9s)
  ✓  TC-003 · Submitting an empty form asks for the username first (1.6s)
  ✓  TC-002 · A wrong password is rejected with the generic credentials error (1.7s)
  -  TC-006 · The password field is masked at all times
  ✓  TC-004 · A username with no password is rejected on the password field (1.3s)

  1 skipped
  5 passed (12.0s)
```

Those five are real browser tests hitting a real site. The sixth is skipped on purpose — see [what it refuses to do](#what-it-refuses-to-do).

<!-- TODO: record this as a GIF -->

## How it works

```
  user story (.txt)
         │
         ▼
  ┌──────────────────┐   system prompt: "senior QA engineer", five required
  │ promptTemplates  │   categories, one action per step, name the defect
  └────────┬─────────┘
           ▼
  ┌──────────────────┐   messages.parse() with a Zod-derived strict JSON schema —
  │   Claude API     │   the model returns a validated object, not prose to scrape
  └────────┬─────────┘
           ▼
  ┌──────────────────┐   parseTestPlan() — the single contract every consumer
  │  TestPlan (JSON) │   goes through. Written to disk with --json.
  └────────┬─────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
  terminal   ┌──────────────────┐   rule-based step → Playwright translation.
             │  codeGenerator   │   No second model call: deterministic, free,
             └────────┬─────────┘   instant, and unit-testable offline.
                      ▼
              generated-tests/*.spec.js  →  npx playwright test
```

Two decisions carry most of the design:

**The test plan is a file, not an internal object.** Phase 1 writes it, Phase 2 reads it. You can inspect it, diff it, hand-edit it, and check it into version control — the codegen is happy either way.

**Step translation is rules, not a second LLM call.** Turning `Click the "Login" button` into `page.getByRole('button', { name: 'Login' }).click()` is a parsing problem, not a reasoning one. Rules make it free, instant, deterministic, and testable without a network call. The AI is used where judgement is actually needed: deciding *what* to test.

## What it refuses to do

The generator never guesses at a step it doesn't understand. Given `Type a 7-character password into the Password field`, there is no literal value to type — so it emits a `TODO`, marks the test `test.fixme`, and reports it:

```
6 tests · 5 runnable · 1 need work · 18/19 steps translated (95%)
```

A test with no assertions is treated the same way, because a test that asserts nothing passes by doing nothing. That's the failure mode this design exists to avoid: **the tool would rather hand you an obviously unfinished test than a green one that checks nothing.**

The skipped `TC-006` in the demo is exactly this — asserting that a field is masked needs a DOM attribute check the rules don't cover, so it's left honestly marked for you to finish.

## Before / after

<!-- TODO-measure: the manual baseline needs a timed human run to be honest. -->
| | Manual | With this tool |
|---|---|---|
| Time to a reviewed test plan | _TODO-measure_ | _TODO-measure_ |
| Plan → runnable Playwright specs | _TODO-measure_ | **< 1s** (measured, no API call) |
| Steps auto-translated to Playwright | — | **95%** on the saucedemo example |
| Categories covered | _TODO-measure_ | 5, enforced by schema |

The measured rows are measured. The manual ones stay blank until there's a real timed run to compare against — an invented "45 minutes" is the one number in this README a reviewer could catch you on.

## Setup

Requires Node 20 or newer.

```bash
git clone https://github.com/afrahossain02/ai-test-generator.git && cd ai-test-generator
npm install
npx playwright install chromium
cp .env.example .env    # then add your key from console.anthropic.com
```

The API key is only needed to generate *new* plans. Codegen and the Playwright run work offline from a saved plan.

## Usage

```bash
# Generate a test plan from a user story
node src/cli.js generate --story examples/sample-user-story.txt

# Generate and compile to Playwright in one step
node src/cli.js generate --story examples/sample-user-story.txt --emit

# Compile a saved plan (no API key needed)
node src/cli.js codegen --plan examples/saucedemo-testplan.json --name saucedemo

# Run whatever is in generated-tests/
npx playwright test

# Point the generated tests at a different environment
BASE_URL=https://staging.example.com npx playwright test
```

### `generate`

| Option | Description |
|---|---|
| `-s, --story <path>` | File containing the user story |
| `-t, --text <story>` | The user story as inline text |
| `-c, --count <n>` | Target number of test cases (default 10) |
| `-j, --json <path>` | Also write the test plan as JSON |
| `-e, --emit [dir]` | Also compile to Playwright specs (default `generated-tests`) |
| `-d, --dry-run` | Use the bundled example plan; makes no API call |
| `-m, --model <id>` | Model to use (default `claude-opus-5`) |

### `codegen`

| Option | Description |
|---|---|
| `-p, --plan <path>` | Test plan JSON to compile (required) |
| `-o, --out-dir <dir>` | Where to write the spec (default `generated-tests`) |
| `-n, --name <name>` | Base filename, without `.spec.js` |

## Development

```bash
npm test             # 59 unit tests, no network, no API calls
npm run check        # syntax gate across src/
npm run demo         # test plan rendering, offline
npm run test:generated  # codegen + real Playwright run against saucedemo
```

The unit tests never hit the API: the generator takes an injectable client, and two guards run offline —

- `outputFormat.test.js` converts the Zod schema to a strict JSON schema locally, so an SDK or Zod upgrade fails in CI rather than at request time.
- `codeGenerator.test.js` runs `node --check` over the generated source, so a malformed emission is caught before Playwright ever sees it. This caught a real bug: a URL assertion rendering as `toHaveURL(//sign-in/)`, where the unescaped slash turned the regex into a line comment.

## Project structure

```
src/
  cli.js                     Commander entrypoint — runs directly, no build step
  generator/
    schema.js                Zod TestPlan/TestCase — the contract between phases
    promptTemplates.js       System and user prompts (the part that gets tuned)
    testCaseGenerator.js     The Claude call
    stepTranslator.js        Step prose → Playwright statements (rule-based)
    codeGenerator.js         TestPlan → .spec.js source
  utils/
    render.js                Terminal output
    errors.js                Typed SDK errors → actionable messages
    paths.js                 ESM-safe path resolution
examples/
  sample-user-story.txt      Generic sign-in story
  fixture-testplan.json      Backs --dry-run
  saucedemo-user-story.txt   Story targeting the live demo site
  saucedemo-testplan.json    Plan behind `npm run test:generated`
tests/                       Vitest, offline
playwright.config.js         Runs generated-tests/, baseURL from BASE_URL
```

`generated-tests/` is git-ignored: it's build output, regenerated from the plan on demand.

## Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 1 | CLI takes a user story, generates a validated test case list | **Done** |
| 2 | Compile the plan into runnable Playwright `.spec.js` files | **Done** |
| 3 | Accept an OpenAPI/Swagger spec and generate API test cases | Next |
| 4 | Coverage report — surface *why* each edge case matters | Planned |
| 5 | Self-healing: on failure, suggest a locator or assertion fix | Stretch |

Phase 4 is mostly rendering work already: every generated case carries a `rationale`.

## License

MIT
