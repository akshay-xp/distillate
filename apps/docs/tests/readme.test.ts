import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HyperLogLog } from "distillate/hll";
import { expect, test } from "vitest";

import { runClaims } from "../src/claims.js";
import { extractSamples } from "../src/samples.js";

const README = fileURLToPath(
  new URL("../../../packages/distillate/README.md", import.meta.url),
);

/** The keys a sample passes to `add`, in order, with duplicates kept. */
function addedKeys(code: string): string[] {
  return [...code.matchAll(/\.add\("([^"]+)"\)/g)].map((m) => m[1]);
}

// Not a claim check: no comment in the sample states this. What it pins is
// that the sample adds "alice" twice on purpose, and that the point of the
// duplicate still holds. Every number the sample quotes is checked by
// runClaims below.
test("the README HyperLogLog sample counts distinct keys, not additions", () => {
  const sample = extractSamples(README).find((s) =>
    s.code.includes("HyperLogLog"),
  );
  if (!sample) throw new Error("README has no HyperLogLog sample");

  const keys = addedKeys(sample.code);
  expect(keys.length).toBeGreaterThan(new Set(keys).size);

  const sketch = HyperLogLog.create(0.01);
  for (const key of keys) sketch.add(key);

  expect(sketch.count()).toBe(new Set(keys).size);
});

test("every package README sample quotes results the library reproduces", async () => {
  await expect(runClaims(extractSamples(README))).resolves.toEqual([]);
});

test("the README Performance section does not leave the sketch unmentioned", () => {
  const md = readFileSync(README, "utf8");
  const start = md.indexOf("## Performance");
  expect(start).toBeGreaterThan(-1);
  const section = md.slice(start, md.indexOf("\n## ", start + 1));
  expect(section).toMatch(/cardinality|HyperLogLog/i);
});
