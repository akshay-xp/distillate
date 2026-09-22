import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HyperLogLog } from "distillate/hll";
import { ScalableBloomFilter } from "distillate/scalable";
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

test("a reader holding a register count is pointed at picking a precision", () => {
  expect(GUIDE).toContain("/guides/hll/#choose-a-precision");
});

test("the scalable mapping covers every call a migrating reader makes", () => {
  const rows = parseTable(GUIDE, "The scalable filter");

  const incumbent = rows.map(([from]) => from);
  for (const call of [
    "new ScalableBloomFilter(initialSize, errorRate, ratio)",
    "ScalableBloomFilter.create(size, errorRate, ratio)",
    "add",
    "has",
    "capacity()",
    "rate()",
    "equals",
    "saveAsJSON",
    "fromJSON",
    "seed",
  ]) {
    expect(
      incumbent.some((cell) => cell.includes(call)),
      `no row maps ${call}`,
    ).toBe(true);
  }
  for (const [from, to] of rows) {
    expect(to.trim(), `${from} maps to nothing`).not.toBe("");
  }
});

test("the scalable section states the incumbent's behaviour differences", () => {
  const at = GUIDE.indexOf("### The scalable filter");
  const section = GUIDE.slice(at, GUIDE.indexOf("\n### ", at + 1));

  expect(section).toContain("errorRate / (1 - ratio)");
  expect(section).toContain("newest stage");
  expect(section).toMatch(/fixed at 2/);
});

// The guide's claim for distillate's side of the comparison: tightening 0.5
// mirrors the incumbent's default ratio, and the chain still holds epsilon.
test("at the incumbent's default ratio the chain still holds its target", () => {
  const f = ScalableBloomFilter.create(1000, 0.01, { tightening: 0.5 });
  for (let i = 0; i < 100_000; i++) f.add(`in:${String(i)}`);
  let hits = 0;
  for (let i = 0; i < 10_000; i++) if (f.has(`out:${String(i)}`)) hits++;
  expect(hits / 10_000).toBeLessThanOrEqual(0.0125);
});

// The doubled bound is stated from the incumbent's source; these are the
// measurements that show it, and they have to be the ones RESULTS.md carries.
test("the scalable section quotes the measured FPR from the bench results", () => {
  const results = readFileSync(
    fileURLToPath(new URL("../../bench/RESULTS.md", import.meta.url)),
    "utf8",
  );
  const bench = results.slice(
    results.indexOf("## Scalable Bloom"),
    results.indexOf("## Throughput"),
  );
  const at = GUIDE.indexOf("### The scalable filter");
  const section = GUIDE.slice(at, GUIDE.indexOf("\n### ", at + 1));

  for (const figure of ["1.60%", "0.99%"]) {
    expect(section, figure).toContain(figure);
    expect(bench, figure).toContain(figure);
  }
});

/** The text under `### heading`, up to the next `### ` or `## `. */
function subsection(heading: string): string {
  const at = GUIDE.indexOf(`### ${heading}`);
  if (at === -1) throw new Error(`no "### ${heading}" section`);
  const next = GUIDE.slice(at + 1).search(/\n##+ /);
  return next === -1 ? GUIDE.slice(at) : GUIDE.slice(at, at + 1 + next);
}

test("the cuckoo mapping covers every call a migrating reader makes", () => {
  const rows = parseTable(GUIDE, "The cuckoo filter");

  const incumbent = rows.map(([from]) => from);
  for (const call of [
    "new CuckooFilter(size, fLength, bucketSize, maxKicks)",
    "CuckooFilter.create(size, errorRate, bucketSize, maxKicks)",
    "CuckooFilter.from(items, errorRate)",
    "add",
    "remove",
    "has",
    "rate()",
    "equals",
    "saveAsJSON",
    "fromJSON",
    "length",
    "size",
    "fullSize",
    "fingerprintLength",
    "bucketSize",
    "maxKicks",
    "seed",
  ]) {
    expect(
      incumbent.some((cell) => cell.includes(call)),
      `no row maps ${call}`,
    ).toBe(true);
  }
  for (const [from, to] of rows) {
    expect(to.trim(), `${from} maps to nothing`).not.toBe("");
  }
  expect(subsection("The cuckoo filter")).toMatch(/returns `false`/);
});

// The bug section was written before distillate had a Cuckoo filter; it now
// has to explain the defect from the incumbent's source and point at ours.
test("the cuckoo bug section explains the defect and links the guide", () => {
  const section = subsection("Its Cuckoo filter has a false-negative bug");

  expect(section).toContain("/guides/cuckoo/");
  expect(section).not.toContain("not yet available");
  expect(section).toMatch(/already been reduced|% size/);
});

// The lost-key counts are the bench's, so a rerun that moves them fails here
// until the guide is updated to match.
test("the cuckoo bug section quotes the lost keys RESULTS.md measured", () => {
  const results = readFileSync(
    fileURLToPath(new URL("../../bench/RESULTS.md", import.meta.url)),
    "utf8",
  );
  const at = results.indexOf("## Cuckoo");
  const bench = results.slice(at, results.indexOf("\n## ", at + 1));
  const lost = (keys: string): string => {
    const row = bench
      .split("\n")
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .find((cells) => cells[1] === "bloom-filters" && cells[2] === keys);
    return /^(\d+)/.exec(row?.[5] ?? "")?.[1] ?? "missing";
  };
  const section = subsection("Its Cuckoo filter has a false-negative bug");
  const plain = section.replaceAll(",", "");

  for (const keys of ["1k", "10k"]) {
    expect(plain, keys).toContain(`${lost(keys)} of`);
  }
  expect(section).toContain("/bench/results/");
});
