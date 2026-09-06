# ai-test-generator

Turns user stories into structured, reviewable test cases using Claude — cutting test design time while surfacing the edge cases that get missed by hand.

> **Status: Phase 1.** The CLI takes a user story, generates a schema-validated test plan, prints it, and can save it as JSON. Playwright code generation is Phase 2 — see the [roadmap](#roadmap).

---

## The problem

Writing a comprehensive test plan is slow, and the parts that get skipped are the parts that matter. Under deadline pressure the happy path gets covered and the boundary conditions don't — the off-by-one at the minimum password length, the lockout counter that increments but never enforces, the "no such account" message that quietly leaks which emails are registered.

Those aren't exotic bugs. They're the ones nobody had time to write a case for.

This tool takes the user story you already wrote and produces a test plan that is explicitly required to cover five categories — happy path, negative, edge, boundary, and security — with a stated reason for each case. You review and edit the output; the tool does the first pass and the remembering.

## Demo

<!-- TODO: record once Phase 2 generates runnable specs -->
_Demo GIF goes here._

Until then, this runs with no API key and no cost:

```bash
npm run demo
```

```
Email and password sign-in for registered customers, with lockout after repeated failures.
10 test cases · generated 2026-09-06T12:00:00.000Z

Happy path: 2  |  Edge cases: 2  |  Negative: 2  |  Boundary: 2  |  Security: 2

Boundary (2)
────────────────────────────────────────────────────────────
  TC-006  A 7-character password is rejected and an 8-character one is accepted  P1
      Given: A registered customer exists whose password is exactly 8 characters
      1. Navigate to /sign-in
      2. Type "ada@example.com" into the Email field
      3. Type a 7-character password into the Password field
         → A length validation message appears
      ...
      Expect: 7 characters is rejected client-side; exactly 8 characters signs in successfully.
      Why: Catches the off-by-one where the minimum is implemented as > 8 rather than >= 8,
           locking out every customer sitting exactly on the limit.
```

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
  terminal    Phase 2: Playwright codegen → .spec.js  (not built yet)
```

The design decision that matters: **the test plan is a file, not an internal object.** Phase 1 writes it, Phase 2's code generator reads it. That makes the phase boundary a contract you can inspect, diff, and hand-edit rather than a refactor waiting to happen.

Structured output means there is no "find the JSON inside the markdown" step. The schema is defined once in [`src/generator/schema.js`](src/generator/schema.js), converted to a strict JSON schema, and the API returns something that validates against it or an error that says why.

## Before / after

<!-- TODO-measure: fill in from a real timed run once Phase 2 lands. -->
| | Manual | With this tool |
|---|---|---|
| Time to a reviewed test plan | _TODO-measure_ | _TODO-measure_ |
| Cases produced | _TODO-measure_ | _TODO-measure_ |
| Categories covered | _TODO-measure_ | 5 (enforced by schema) |

These are deliberately blank rather than estimated. They get filled in from a timed run, not from a guess.

## Setup

Requires Node 20 or newer.

```bash
git clone <your-repo-url> && cd ai-test-generator
npm install
cp .env.example .env    # then add your key from console.anthropic.com
```

## Usage

```bash
# From a file
node src/cli.js generate --story examples/sample-user-story.txt

# Inline, asking for more cases, saving the plan
node src/cli.js generate --text "As a user I want to reset my password" --count 15 --json plan.json

# No API key, no cost — renders the bundled example plan
node src/cli.js generate --dry-run
```

| Option | Description |
|---|---|
| `-s, --story <path>` | File containing the user story |
| `-t, --text <story>` | The user story as inline text |
| `-c, --count <n>` | Target number of test cases (default 10) |
| `-j, --json <path>` | Also write the test plan as JSON |
| `-d, --dry-run` | Use the bundled example plan; makes no API call |
| `-m, --model <id>` | Model to use (default `claude-opus-5`) |

## Development

```bash
npm test      # 27 unit tests, no network calls
npm run check # syntax gate across src/
npm run demo  # the dry-run example
```

Tests never hit the API: the generator takes an injectable client, and one test converts the Zod schema to a strict JSON schema offline so an SDK or Zod upgrade fails in CI rather than at request time.

## Project structure

```
src/
  cli.js                     Commander entrypoint — runs directly, no build step
  generator/
    schema.js                Zod TestPlan/TestCase — the contract between phases
    promptTemplates.js       System and user prompts (the part that gets tuned)
    testCaseGenerator.js     The Claude call
  utils/
    render.js                Terminal output
    errors.js                Typed SDK errors → actionable messages
    paths.js                 ESM-safe path resolution
examples/
  sample-user-story.txt      Input for the demo
  fixture-testplan.json      Backs --dry-run
tests/                       Vitest, offline
```

## Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 1 | CLI takes a user story, generates a validated test case list | **Done** |
| 2 | Convert the test plan into runnable Playwright `.spec.js` files | Next |
| 3 | Accept an OpenAPI/Swagger spec and generate API test cases | Planned |
| 4 | Coverage report — surface *why* each edge case matters | Planned |
| 5 | Self-healing: on failure, suggest a locator or assertion fix | Stretch |

Phase 4 is mostly rendering work already: every generated case carries a `rationale` today.

## License

MIT
