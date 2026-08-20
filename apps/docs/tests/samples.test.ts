import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, test } from "vitest";

import { extractSamples, typecheckSamples } from "../src/samples.js";

const DOCS = fileURLToPath(new URL("../src/content/docs", import.meta.url));

let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), "distillate-samples-"));
  writeFileSync(
    join(fixture, "broken.md"),
    [
      "---",
      "title: Broken",
      "---",
      "",
      "```ts",
      'import { BloomFilter } from "distillate/bloom";',
      "",
      "const filter = BloomFilter.create(1000, 0.01);",
      "filter.nonexistentMethod();",
      "```",
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

test("extractSamples collects fenced ts blocks", () => {
  const samples = extractSamples(fixture);
  expect(samples).toHaveLength(1);
  expect(samples[0]?.file).toBe("broken.md");
  expect(samples[0]?.code).toContain("nonexistentMethod");
});

test("a sample using an API the build does not have is a diagnostic", () => {
  const diagnostics = typecheckSamples(extractSamples(fixture));
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics.join("\n")).toContain("nonexistentMethod");
});

test("every documentation sample typechecks against the workspace build", () => {
  const samples = extractSamples(DOCS);
  expect(samples.length).toBeGreaterThan(0);
  expect(typecheckSamples(samples)).toEqual([]);
});
