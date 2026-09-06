import path from "node:path";
import { fileURLToPath } from "node:url";

// __dirname does not exist in ES modules — derive it from import.meta.url.
const here = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(here, "..", "..");
export const examplesDir = path.join(projectRoot, "examples");
export const fixtureTestPlanPath = path.join(examplesDir, "fixture-testplan.json");
export const sampleUserStoryPath = path.join(examplesDir, "sample-user-story.txt");
