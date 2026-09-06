# ai-test-generator

Turns user stories and OpenAPI specs into structured test cases and runnable Playwright specs — cutting test design time while surfacing the edge cases that get missed by hand.

> **Status: Phase 4.** The CLI takes a user story *or* an OpenAPI/Swagger document, generates a schema-validated test plan, compiles it into Playwright specs, and reports on what the plan covers, what it misses, and how the last run went. Only self-healing is left — see the [roadmap](#roadmap).

---

## The problem

Writing a comprehensive test plan is slow, and the parts that get skipped are the parts that matter. Under deadline pressure the happy path gets covered and the boundary conditions don't — the off-by-one at the minimum password length, the lockout counter that increments but never enforces, the "no such account" message that quietly leaks which emails are registered.

Those aren't exotic bugs. They're the ones nobody had time to write a case for.

This tool takes the user story or API spec you already have, produces a test plan that must cover five categories — happy path, negative, edge, boundary, and security — with a stated reason for each case, and then compiles that plan into Playwright tests you can run.

## Demo

Both demos generate specs and run them against live public targets, with no API key needed:

```bash
npm run test:generated
```

```
✓ Wrote generated-tests/saucedemo.ui.spec.js
  6 tests · 5 runnable · 1 need work · 18/19 steps translated (95%) · 7 assertions
✓ Wrote generated-tests/jsonplaceholder.api.spec.js
  10 tests · 9 runnable · 1 need work · 10/10 steps translated (100%) · 21 assertions

Running 16 tests using 2 workers
  ✓  [ui]  TC-001 · Valid credentials land the shopper on the product catalogue (3.1s)
  ✓  [ui]  TC-005 · A locked-out account is refused even with the correct password (2.9s)
  ✓  [ui]  TC-002 · A wrong password is rejected with the generic credentials error (1.8s)
  ✓  [ui]  TC-003 · Submitting an empty form asks for the username first (1.6s)
  ✓  [ui]  TC-004 · A username with no password is rejected on the password field (1.2s)
  ✓  [api] TC-001 · Listing posts returns a non-empty collection (503ms)
  ✓  [api] TC-002 · Fetching a known post returns that post (173ms)
  ✓  [api] TC-004 · Creating a post echoes the submitted fields with a new id (939ms)
  ✓  [api] TC-006 · Post id zero is treated as not found, not as a falsy default (49ms)
  ✓  [api] TC-009 · A user record does not leak credential material (63ms)
  ...
  2 skipped
  14 passed (10.9s)
```

Fourteen real tests: browser tests against [saucedemo.com](https://www.saucedemo.com), API tests against [JSONPlaceholder](https://jsonplaceholder.typicode.com). The two skips are deliberate — see [what it refuses to do](#what-it-refuses-to-do).

<!-- TODO: record this as a GIF -->

## How it works

```
  user story (.txt)          OpenAPI / Swagger (.yaml|.json)
         │                              │
         │                              ▼
         │                    ┌──────────────────┐  flatten paths×methods to
         │                    │  openapi/parser  │  params, body, responses.
         │                    └────────┬─────────┘  Summarised, never inlined.
         ▼                              ▼
  ┌──────────────────┐   system prompt: "senior QA engineer", five required
  │ promptTemplates  │   categories, one action per step, name the defect
  └────────┬─────────┘   (the API prompt teaches the exact compilable phrasings)
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
        generated-tests/*.ui.spec.js   →  page fixture, UI_BASE_URL
        generated-tests/*.api.spec.js  →  request fixture, API_BASE_URL
                      ▼
                npx playwright test
```

Two decisions carry most of the design:

**The test plan is a file, not an internal object.** Phase 1 writes it, Phase 2 reads it. You can inspect it, diff it, hand-edit it, and check it into version control — the codegen is happy either way.

**Step translation is rules, not a second LLM call.** Turning `Click the "Login" button` into `page.getByRole('button', { name: 'Login' }).click()` is a parsing problem, not a reasoning one. Rules make it free, instant, deterministic, and testable without a network call. The AI is used where judgement is actually needed: deciding *what* to test.

**The API prompt and the API rules are a matched pair.** The prompt tells the model the exact sentence shapes that compile (`Send POST /posts with body {...}`, `The response status is 201`). If they drift apart, every generated case lands as `test.fixme` — so a test asserts that each rule's phrasing appears in the prompt. That test has already caught one real drift: a `does not contain` rule added without teaching the prompt about it, which would have made the rule dead code.

## What it refuses to do

The generator never guesses at a step it doesn't understand. Given `Type a 7-character password into the Password field`, there is no literal value to type — so it emits a `TODO`, marks the test `test.fixme`, and reports it:

```
6 tests · 5 runnable · 1 need work · 18/19 steps translated (95%)
```

A test with no assertions is treated the same way, because a test that asserts nothing passes by doing nothing. That's the failure mode this design exists to avoid: **the tool would rather hand you an obviously unfinished test than a green one that checks nothing.**

Both skips in the demo are exactly this. `TC-006` wants a DOM attribute check for a masked password field; `TC-010` wants a response-latency budget. Neither is expressible in the current rules, so both are left honestly marked for you to finish rather than quietly dropped or faked.

## Coverage report

```bash
npm run report
```

```
Coverage report
Posts and users endpoints of the JSONPlaceholder API.

  10 cases · 9 automated (90%) · 21 assertions
  Last run: 9 passed · 0 failed · 1 skipped

  Happy path: 4  |  Edge cases: 2  |  Negative: 2  |  Boundary: 1  |  Security: 1

  Gaps to review

  [Low] Only one boundary case, against 4 elsewhere.
        Uneven depth usually means a category was filled to satisfy the format rather than the risk.
```

A committed example of the Markdown output: **[docs/example-coverage-report.md](docs/example-coverage-report.md)**.

Three things make this more than a pretty-printer:

**Automation figures come from the real code generator.** The report compiles the plan to get them, so it cannot claim a case is automated when codegen would leave it as `test.fixme`.

**It folds in an actual run.** Give it `--results` from `playwright test --reporter=json` and each case carries its last outcome, with failures surfaced next to the rationale explaining what that case was protecting.

**Gaps are mechanical, not vague.** Every finding names a fact you can verify in seconds — "no security cases at all", "1 P0 case could not be automated: TC-006" — rather than advising you to consider more coverage. `--fail-on-gaps` turns a high-severity finding into a non-zero exit for CI.

The "why this matters" text is not a second AI call. The model wrote each `rationale` at generation time; asking again would cost money to get a differently-worded answer to a question already answered.

## Before / after

<!-- TODO-measure: the manual baseline needs a timed human run to be honest. -->
| | Manual | With this tool |
|---|---|---|
| Time to a reviewed test plan | _TODO-measure_ | _TODO-measure_ |
| Plan → runnable Playwright specs | _TODO-measure_ | **< 1s** (measured, no API call) |
| Steps auto-translated to Playwright | — | **95%** UI, **100%** API on the examples |
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
# From a user story → browser tests
node src/cli.js generate --story examples/sample-user-story.txt --emit

# From an OpenAPI spec → API tests
node src/cli.js generate --spec examples/jsonplaceholder-openapi.yaml --emit

# Only the endpoints you care about
node src/cli.js generate --spec ./openapi.yaml --filter "^(GET|POST) /orders"

# Compile a saved plan (no API key needed)
node src/cli.js codegen --plan examples/fixture-api-testplan.json --name jsonplaceholder

# Run what was generated
npx playwright test
npx playwright test --project=api

# Report on coverage, gaps and the last run
node src/cli.js report --plan examples/fixture-api-testplan.json
npx playwright test --reporter=json > results.json
node src/cli.js report --plan plan.json --results results.json --out coverage.md

# Point the generated tests at another environment
UI_BASE_URL=https://staging.example.com npx playwright test --project=ui
API_BASE_URL=https://api.staging.example.com npx playwright test --project=api
```

### `generate`

| Option | Description |
|---|---|
| `-s, --story <path>` | File containing the user story |
| `-t, --text <story>` | The user story as inline text |
| `-S, --spec <path>` | OpenAPI 3 or Swagger 2 file, JSON or YAML → generates API tests |
| `-f, --filter <pattern>` | With `--spec`, only endpoints matching this regex (`METHOD /path`, operationId, or tag) |
| `-c, --count <n>` | Target number of test cases (default 10) |
| `-j, --json <path>` | Also write the test plan as JSON |
| `-e, --emit [dir]` | Also compile to Playwright specs (default `generated-tests`) |
| `-d, --dry-run` | Use a bundled example plan; makes no API call |
| `-m, --model <id>` | Model to use (default `claude-opus-5`) |

Exactly one of `--story`, `--text` or `--spec` is required.

### `codegen`

| Option | Description |
|---|---|
| `-p, --plan <path>` | Test plan JSON to compile (required) |
| `-o, --out-dir <dir>` | Where to write the spec (default `generated-tests`) |
| `-n, --name <name>` | Base filename; `.ui.spec.js` or `.api.spec.js` is appended by mode |

### `report`

| Option | Description |
|---|---|
| `-p, --plan <path>` | Test plan JSON to report on (required) |
| `-r, --results <path>` | Playwright JSON report, to fold in pass/fail |
| `-o, --out <path>` | Also write the report as Markdown |
| `--fail-on-gaps` | Exit non-zero if any high-severity gap is found |

`--filter` matters on real specs. A production OpenAPI document can declare hundreds of operations; handing all of them to one prompt produces a shallow plan and a large bill. Generate per resource instead.

## Development

```bash
npm test                # 133 unit tests, no network, no API calls
npm run check           # syntax gate across src/
npm run demo            # user-story plan rendering, offline
npm run demo:api        # OpenAPI plan rendering, offline
npm run test:generated  # codegen + real Playwright run, UI and API
npm run report          # the above, plus a refreshed coverage report
```

The unit tests never hit the API: the generator takes an injectable client, and three guards run offline —

- `outputFormat.test.js` converts the Zod schema to a strict JSON schema locally, so an SDK or Zod upgrade fails in CI rather than at request time.
- `codeGenerator.test.js` runs `node --check` over the generated source, so a malformed emission is caught before Playwright sees it. This caught a real bug: a URL assertion rendering as `toHaveURL(//sign-in/)`, where the unescaped slash turned the regex into a line comment.
- `prompt.test.js` asserts the API prompt teaches every phrasing the API rules can compile, so the two cannot drift apart silently.

## Project structure

```
src/
  cli.js                       Commander entrypoint — runs directly, no build step
  generator/
    schema.js                  Zod TestPlan/TestCase — the contract between phases
    promptTemplates.js         UI and API prompts (the part that gets tuned)
    testCaseGenerator.js       The Claude call, one path per input type
    stepTranslator.js          Step prose → Playwright statements (ui + api rules)
    codeGenerator.js           TestPlan → .spec.js source, branching on sourceType
  openapi/
    parser.js                  OpenAPI 3 / Swagger 2 → flat operations, filter, summary
  report/
    coverage.js                Plan + run → coverage, gaps, automation status
    playwrightResults.js       Playwright JSON report → per-case outcomes
    render.js                  Markdown and terminal report output
  utils/
    render.js                  Terminal output
    errors.js                  Typed SDK errors → actionable messages
    paths.js                   ESM-safe path resolution
examples/
  sample-user-story.txt        Generic sign-in story
  fixture-testplan.json        Backs --dry-run
  saucedemo-user-story.txt     Story targeting the live demo site
  saucedemo-testplan.json      UI plan behind `npm run test:generated`
  jsonplaceholder-openapi.yaml OpenAPI spec for the API demo
  fixture-api-testplan.json    API plan behind `npm run test:generated`
docs/
  example-coverage-report.md   Committed sample of the Markdown report
tests/                         Vitest, offline
playwright.config.js           ui and api projects, each with its own baseURL
```

`generated-tests/` is git-ignored: it's build output, regenerated from a plan on demand.

## Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 1 | CLI takes a user story, generates a validated test case list | **Done** |
| 2 | Compile the plan into runnable Playwright `.spec.js` files | **Done** |
| 3 | Accept an OpenAPI/Swagger spec and generate API test cases | **Done** |
| 4 | Coverage report — surface *why* each edge case matters | **Done** |
| 5 | Self-healing: on failure, suggest a locator or assertion fix | Next (stretch) |

Phase 5 is the one place a second model call clearly earns its cost: a failing test plus the page snapshot is exactly the kind of input a model is better at than a rule.

## License

MIT
