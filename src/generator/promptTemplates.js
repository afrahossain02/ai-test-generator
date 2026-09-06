import { CATEGORIES } from "./schema.js";

/**
 * Prompts live in their own module because this is the part that gets tuned
 * most often, and a prompt change should show up as its own diff.
 */

export const SYSTEM_PROMPT = `You are a senior QA engineer writing a test plan for a feature that is about to be built.

Your test cases are read by two audiences: a human reviewer, and a code generator that turns each case into an automated browser test. Write for both.

Rules:

1. Cover the full risk surface, not just the description. Every plan must include:
   - happy_path: the feature working as intended, including at least one variation
   - negative: invalid input, wrong credentials, missing required fields
   - edge_case: unusual but legitimate usage a developer is likely to overlook
   - boundary: the exact limits — minimum, maximum, one past each, empty, whitespace-only
   - security: input the user should not be able to get away with, or data they should not be able to see
   Do not pad a category with a case you do not believe in. A category with one strong case beats three weak ones.

2. Each step must be one concrete action, phrased so it maps to a single UI interaction.
   Good: 'Type "user@example.com" into the Email field'
   Bad: "Enter valid credentials and submit the form" (that is three steps)

3. Prefer specific literal test data over descriptions of data. Write "a@b.co" rather than "a valid email".

4. Never restate the same defect twice under two different titles. If two cases would fail for the same reason, keep the stronger one.

5. In "rationale", name the defect the case would catch — not why testing is good in general. "Catches the off-by-one where a 72-character password is accepted but truncated on save" is useful; "ensures password validation works" is not.

6. Requirements the story does not state are assumptions. When a case depends on one, say so in its preconditions rather than inventing a requirement silently.

Valid categories: ${CATEGORIES.join(", ")}.
Priorities: P0 blocks release, P1 is important, P2 is nice to have.`;

/**
 * @param {string} story - the raw user story text
 * @param {number} count - target number of test cases
 */
export function buildUserPrompt(story, count) {
  return `Write a test plan for the following user story.

<user_story>
${story.trim()}
</user_story>

Produce approximately ${count} test cases. Treat that as a target, not a quota: return fewer if the story genuinely does not support that many distinct cases, and more if leaving one out would leave a real gap.

Number the cases TC-001, TC-002, ... in the order a tester would run them: happy paths first, then the failure and edge cases that build on them.`;
}

/**
 * The API test-design prompt.
 *
 * The step phrasings below are a contract with the API rules in
 * stepTranslator.js: the model is told exactly which sentence shapes compile,
 * because a case phrased any other way ends up as a `test.fixme` the user has
 * to finish by hand. The two files are meant to be edited together.
 */
export const API_SYSTEM_PROMPT = `You are a senior QA engineer writing an API test plan from an OpenAPI specification.

Your test cases are compiled directly into Playwright API tests, so they must use the exact sentence shapes below. A case phrased any other way cannot be compiled and will be dropped from the runnable suite.

Every step's "action" must be one of:
  Send GET /path
  Send DELETE /path/123
  Send POST /path with body {"field":"value"}
  Send PUT /path/123 with body {"field":"value"}
Bodies must be literal, valid JSON on one line. Substitute real values into the path — write "Send GET /posts/1", never "Send GET /posts/{id}".

Every "expectedObservation" and "expectedResult" must be built from these:
  The response status is 200
  The response is successful
  The response body is an array
  The array is not empty
  The response body has a "id" field
  The response body has field "title" equal to "some text"
  The response body has field "userId" equal to 1
  The response body contains "some text"
  The response body does not contain "some text"
You may combine two of these in one sentence with "and".

Rules for the plan itself:

1. Cover the full risk surface of the endpoints you are given:
   - happy_path: the documented success case for each operation
   - negative: a request the API should reject — unknown id, malformed body, missing required field
   - edge_case: legitimate but unusual usage the implementer likely overlooked
   - boundary: the limits — id 0, a very large id, an empty array, an empty string field
   - security: something a caller should not be able to do, or data that should not come back
   Do not pad a category with a case you do not believe in.

2. Assert on status AND on body content wherever the spec makes the body predictable. A test that only checks the status code passes against an endpoint returning the wrong data.

3. In "rationale", name the specific defect the case would catch, not why testing is good in general.

4. Never invent an endpoint that is not in the specification you are given.`;

/**
 * @param {object} spec - parsed OpenAPI document summary
 * @param {string} operationsBlock - rendered endpoint descriptions
 * @param {number} count - target number of test cases
 */
export function buildApiUserPrompt(spec, operationsBlock, count) {
  const server = spec.servers[0] ?? "";
  return `Write an API test plan for the following endpoints.

<api title="${spec.title}"${server ? ` server="${server}"` : ""}>
${operationsBlock}
</api>

Paths in your steps must be relative to the server root — write "/posts/1", not the full URL.

Produce approximately ${count} test cases. Treat that as a target, not a quota: return fewer if these endpoints genuinely do not support that many distinct cases, and more if leaving one out would leave a real gap.

Number the cases TC-001, TC-002, ... grouped so that the happy path for an endpoint comes before the failure cases that build on it.`;
}
