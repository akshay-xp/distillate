import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";
import { parse } from "yaml";

const WORKFLOWS = fileURLToPath(
  new URL("../../../.github/workflows", import.meta.url),
);

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"));
}

function read(file: string): string {
  return readFileSync(join(WORKFLOWS, file), "utf8");
}

/** Lines carrying a `uses:`, paired with the action reference on them. */
function usesLines(yml: string): { line: string; action: string }[] {
  return yml.split("\n").flatMap((line) => {
    const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
    return match ? [{ line, action: match[1] }] : [];
  });
}

// A moving tag is a supply-chain hole: whoever controls the tag controls what
// runs against this repo's token. The version comment is what keeps the pin
// readable, so both halves are required, not just the SHA.
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)*@[0-9a-f]{40}$/;

test("every action every workflow uses is pinned to a SHA with a version", () => {
  const files = workflowFiles();

  expect(files).toContain("docs.yml");
  for (const file of files) {
    const uses = usesLines(read(file));
    expect(uses.length).toBeGreaterThan(0);
    for (const { line, action } of uses) {
      expect(action, `${file} uses an unpinned action`).toMatch(PINNED);
      expect(line, `${file} pins ${action} with no version comment`).toContain(
        "# v",
      );
    }
  }
});

interface Job {
  needs?: string | string[];
  if?: string;
  steps?: { run?: string; uses?: string }[];
}

interface Workflow {
  on: { pull_request?: unknown; push?: { branches?: string[] } };
  jobs: Record<string, Job | undefined>;
}

function docsWorkflow(): Workflow {
  return parse(read("docs.yml")) as Workflow;
}

/** Every `run:` command in a job, flattened. */
function runsIn(job: Job | undefined): string[] {
  return (job?.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => run !== undefined);
}

test("the docs workflow builds and link-checks on every pull request", () => {
  const workflow = docsWorkflow();

  expect(workflow.on).toHaveProperty("pull_request");
  expect(workflow.on.push?.branches).toEqual(["main"]);

  const runs = runsIn(workflow.jobs.build);
  expect(runs.some((r) => r.includes("distillate-docs build"))).toBe(true);
  expect(runs.some((r) => r.includes("links:check"))).toBe(true);
});

// Deploying from a pull request branch would publish unreviewed content to the
// live site, so the gate is asserted rather than trusted: both that the deploy
// job carries it, and that the job running on pull requests cannot deploy.
test("only a push to main can deploy", () => {
  const { jobs } = docsWorkflow();
  const deploy = jobs.deploy;

  expect(deploy?.needs).toContain("build");
  expect(deploy?.if).toContain("github.event_name == 'push'");
  expect(deploy?.if).toContain("refs/heads/main");

  const deploying = (jobs.build?.steps ?? []).filter((step) =>
    step.uses?.includes("wrangler"),
  );
  expect(deploying).toEqual([]);
});
