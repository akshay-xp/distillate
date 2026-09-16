import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HyperLogLog } from "distillate/hll";
import { expect, test } from "vitest";

import { parseTable } from "../src/tables.js";

const GUIDE = readFileSync(
  fileURLToPath(
    new URL(
      "../src/content/docs/guides/migrating-from-bloom-filters.md",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("the sketch mapping covers every call a migrating reader makes", () => {
  const rows = parseTable(GUIDE, "The cardinality sketch");
  expect(rows).toHaveLength(6);

  const incumbent = rows.map(([from]) => from);
  for (const call of [
    "new HyperLogLog(nbRegisters)",
    "update",
    "count",
    "merge",
    "saveAsJSON",
  ]) {
    expect(
      incumbent.some((cell) => cell.includes(call)),
      `no row maps ${call}`,
    ).toBe(true);
  }

  // Every row has to land somewhere; a blank right cell is an unmapped call.
  for (const [from, to] of rows) {
    expect(to.trim(), `${from} maps to nothing`).not.toBe("");
  }
});

test("union folds to the coarser precision, where merge demands a match", () => {
  const fine = new HyperLogLog({ p: 14 });
  const coarse = new HyperLogLog({ p: 12 });
  fine.add("alice");
  coarse.add("bob");

  // The claim the guide makes: unequal precisions are allowed, and the
  // coarser one wins rather than the call being rejected.
  expect(fine.union(coarse).p).toBe(12);
  expect(coarse.union(fine).p).toBe(12);

  expect(GUIDE).toContain("coarser precision");
});

test("the small-range defect names both of the incumbent's regimes", () => {
  const at = (heading: string): number => GUIDE.indexOf(heading);

  // Where it fails, and where it is fine. One without the other is a
  // half-truth: past about 2.5 * m the incumbent is a reasonable sketch.
  expect(GUIDE).toContain("49.63%");
  expect(GUIDE).toContain("0.78%");
  expect(GUIDE).toContain("/bench/results/");

  const section = at("### Its HyperLogLog is wrong for small counts");
  expect(section).toBeGreaterThan(at("## What the incumbent costs you"));
  expect(section).toBeLessThan(at("## What changes in your code"));
});

test("the exactness the guide claims is the sparse store, not the estimator", () => {
  const sketch = new HyperLogLog({ p: 14 });
  for (let i = 0; i < 1000; i++) sketch.add(`key:${String(i)}`);

  // Exact, because below promotion it is still counting entries rather than
  // estimating from registers. This is the fact the guide attributes.
  expect(sketch.count()).toBe(1000);

  expect(GUIDE).toContain("sparse");
  expect(GUIDE).toContain("Its estimator is not better");
});

test("the measured gains section carries the sketch, not just the filters", () => {
  const rows = parseTable(GUIDE, "And in cardinality");
  const flat = rows.flat().join(" ");

  // Quoted from the 10M row of apps/bench/RESULTS.md, at a matched m = 16384.
  for (const figure of ["0.63 s", "1164.62 s", "12314", "40247"]) {
    expect(flat, `${figure} missing from the cardinality table`).toContain(
      figure,
    );
  }

  expect(GUIDE).toContain("/bench/methodology/");
});
