#!/usr/bin/env node
import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";
import pc from "picocolors";

import { generateTestPlan, DEFAULT_MODEL } from "./generator/testCaseGenerator.js";
import { generateSpec, slugify, summarizeStats } from "./generator/codeGenerator.js";
import { parseTestPlan } from "./generator/schema.js";
import { renderTestPlan } from "./utils/render.js";
import { describeError } from "./utils/errors.js";
import { fixtureTestPlanPath } from "./utils/paths.js";

const program = new Command();

program
  .name("ai-testgen")
  .description("Turn a user story into a structured test plan using Claude.")
  .version("0.1.0");

program
  .command("generate")
  .description("Generate test cases from a user story")
  .option("-s, --story <path>", "path to a file containing the user story")
  .option("-t, --text <story>", "the user story as inline text")
  .option("-c, --count <n>", "target number of test cases", "10")
  .option("-j, --json <path>", "also write the test plan as JSON to this path")
  .option("-d, --dry-run", "use the bundled example plan; makes no API call", false)
  .option("-m, --model <id>", "model to use", process.env.AI_TESTGEN_MODEL || DEFAULT_MODEL)
  .option("-e, --emit [dir]", "also write a Playwright spec file into this directory")
  .action(async (options) => {
    try {
      await runGenerate(options);
    } catch (error) {
      const { message, hint } = describeError(error);
      console.error(`\n${pc.red("✗")} ${message}`);
      if (hint) console.error(`  ${pc.dim(hint)}`);
      console.error("");
      process.exitCode = 1;
    }
  });

async function runGenerate(options) {
  const count = Number.parseInt(options.count, 10);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--count must be a positive integer, got "${options.count}".`);
  }

  const plan = options.dryRun
    ? loadFixturePlan()
    : await generateLivePlan({ ...options, count });

  process.stdout.write(`${renderTestPlan(plan)}\n`);

  if (options.json) {
    const outPath = path.resolve(options.json);
    fs.writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(pc.dim(`Wrote ${plan.testCases.length} test cases to ${outPath}`));
  }

  if (options.emit) {
    const outDir = typeof options.emit === "string" ? options.emit : DEFAULT_OUT_DIR;
    writeSpec(plan, { outDir });
  }
}

const DEFAULT_OUT_DIR = "generated-tests";

/** Renders a plan as a Playwright spec and writes it, reporting what it produced. */
function writeSpec(plan, { outDir, name }) {
  const { source, stats } = generateSpec(plan);
  const fileName = `${name ?? slugify(plan.sourceSummary)}.spec.js`;
  const outPath = path.resolve(outDir, fileName);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, source);

  console.log(`\n${pc.green("✓")} Wrote ${pc.bold(path.relative(process.cwd(), outPath))}`);
  console.log(pc.dim(`  ${summarizeStats(stats)}`));

  if (stats.fixme > 0) {
    console.log(
      pc.dim(
        `  ${stats.fixme} test${stats.fixme === 1 ? "" : "s"} marked test.fixme — steps the generator could not translate are left as TODOs rather than passing silently.`,
      ),
    );
  }
  console.log(pc.dim(`  Run them with: npx playwright test ${path.relative(process.cwd(), outPath)}`));

  return { outPath, stats };
}

function loadFixturePlan() {
  console.log(pc.dim("Dry run — using the bundled example plan, no API call made."));
  // Validated on the way in, so a broken fixture fails here rather than in the renderer.
  return parseTestPlan(JSON.parse(fs.readFileSync(fixtureTestPlanPath, "utf8")));
}

async function generateLivePlan({ story: storyPath, text, count, model }) {
  const story = readStory({ storyPath, text });

  console.log(pc.dim(`Generating ~${count} test cases with ${model}...`));
  const started = Date.now();

  const { plan, usage } = await generateTestPlan({ story, count, model });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    pc.dim(
      `Done in ${seconds}s · ${usage.input_tokens} in / ${usage.output_tokens} out tokens`,
    ),
  );

  // The model's output is schema-checked already; this also proves the object
  // we are about to write matches the on-disk contract Phase 2 will read.
  return parseTestPlan(plan);
}

function readStory({ storyPath, text }) {
  if (text) return text;

  if (!storyPath) {
    throw new Error(
      "No user story given. Pass --story <path> or --text \"...\" (or --dry-run to see an example).",
    );
  }

  const resolved = path.resolve(storyPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`No such file: ${resolved}`);
  }
  return fs.readFileSync(resolved, "utf8");
}

program
  .command("codegen")
  .description("Turn a saved test plan into a Playwright spec file")
  .requiredOption("-p, --plan <path>", "path to a test plan JSON file")
  .option("-o, --out-dir <dir>", "directory to write the spec into", DEFAULT_OUT_DIR)
  .option("-n, --name <name>", "base name for the spec file (without .spec.js)")
  .action((options) => {
    try {
      const planPath = path.resolve(options.plan);
      if (!fs.existsSync(planPath)) {
        throw new Error(`No such file: ${planPath}`);
      }
      // Validated on the way in: a hand-edited plan fails here with a schema
      // error rather than producing a broken spec file.
      const plan = parseTestPlan(JSON.parse(fs.readFileSync(planPath, "utf8")));
      writeSpec(plan, { outDir: options.outDir, name: options.name });
    } catch (error) {
      const { message, hint } = describeError(error);
      console.error(`\n${pc.red("✗")} ${message}`);
      if (hint) console.error(`  ${pc.dim(hint)}`);
      console.error("");
      process.exitCode = 1;
    }
  });

program.parse();
