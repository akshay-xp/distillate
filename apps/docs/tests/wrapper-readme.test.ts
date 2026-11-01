import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HyperLogLog } from "distillate/hll";
import { expect, test } from "vitest";

import { runClaims } from "../src/claims.js";
import { extractSamples } from "../src/samples.js";

const README = fileURLToPath(
  new URL("../../../packages/hyperloglog/README.md", import.meta.url),
);
const md = (): string => readFileSync(README, "utf8");

test("the wrapper README's samples quote results the library reproduces", async () => {
  const samples = extractSamples(README);
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.some((s) => s.code.includes("@distillate/hyperloglog"))).toBe(
    true,
  );
  await expect(runClaims(samples)).resolves.toEqual([]);
});

// Prose numbers are outside the claims check, so these two are computed here.
test("the wrapper README quotes the size and error the library computes", () => {
  const sketch = HyperLogLog.create(0.01);
  for (let i = 0; i < 100_000; i++) sketch.add(`key-${String(i)}`);

  expect(md()).toContain(
    `${String(Math.round(sketch.toBytes().length / 1024))} KiB`,
  );
  expect(md()).toContain(`${(sketch.standardError * 100).toFixed(1)}%`);
});

// Timings belong to one machine on one day, so they stay in RESULTS.md.
test("the wrapper README links its sources and quotes no timings", () => {
  const results = fileURLToPath(
    new URL("../../bench/RESULTS.md", import.meta.url),
  );
  expect(readFileSync(results, "utf8")).toContain("\n## Cardinality\n");
  expect(md()).toContain("RESULTS.md#cardinality");
  expect(md()).toContain("https://distillate.akxp.net/guides/hll/");
  expect(md()).toMatch(/depends only on `?distillate/i);
  expect(md()).not.toMatch(/\d\s*(ns|µs|ms)\b|ops\/s/);
});
