import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { HyperLogLog } from "../../src/hll/hll.js";

const keys = (tag: string, n: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`${tag}:${String(i)}`);
  return out;
};

const sketchOf = (pool: readonly string[], p = 14, seed = 0): HyperLogLog => {
  const sketch = new HyperLogLog({ p, seed });
  for (const key of pool) sketch.add(key);
  return sketch;
};

// A sketch under the promotion threshold is sparse, one well over it is dense.
// At p=14 the sparse buffer holds 3072 entries, so 100 keys stay sparse and
// 5000 are long past promoted.
test("union of two sparse sketches holds both key sets", () => {
  const a = keys("a", 100);
  const b = keys("b", 100);
  const merged = sketchOf(a).union(sketchOf(b));

  expect(merged.equals(sketchOf([...a, ...b]))).toBe(true);
  expect(merged.count()).toBe(200);
});

test("union of two dense sketches holds both key sets", () => {
  const a = keys("a", 5000);
  const b = keys("b", 5000);
  const merged = sketchOf(a).union(sketchOf(b));

  expect(merged.equals(sketchOf([...a, ...b]))).toBe(true);
});

test("union pairs a sparse sketch with a dense one, either way round", () => {
  const a = keys("a", 100);
  const b = keys("b", 5000);
  const reference = sketchOf([...a, ...b]);

  expect(sketchOf(a).union(sketchOf(b)).equals(reference)).toBe(true);
  expect(sketchOf(b).union(sketchOf(a)).equals(reference)).toBe(true);
});

test("union with a subset changes nothing", () => {
  const a = keys("a", 5000);
  const merged = sketchOf(a).union(sketchOf(a.slice(0, 1000)));
  expect(merged.equals(sketchOf(a))).toBe(true);
});

test("union leaves both operands as they were", () => {
  const a = sketchOf(keys("a", 100));
  const b = sketchOf(keys("b", 5000));
  const aBefore = a.count();
  const bBefore = b.count();

  a.union(b);

  expect(a.count()).toBe(aBefore);
  expect(b.count()).toBe(bBefore);
  expect(a.p).toBe(14);
  expect(b.p).toBe(14);
  expect(a.equals(sketchOf(keys("a", 100)))).toBe(true);
  expect(b.equals(sketchOf(keys("b", 5000)))).toBe(true);
});

// Merging sketches of unequal precision takes the coarser one, matching
// BigQuery HLL++ and DataSketches. A finer sketch can always be folded down;
// the reverse would invent detail it never recorded.
test("union of unequal precisions folds to the coarser one", () => {
  const a = keys("a", 5000);
  const b = keys("b", 5000);
  const reference = sketchOf([...a, ...b], 10);

  const merged = sketchOf(a, 14).union(sketchOf(b, 10));
  expect(merged.p).toBe(10);
  expect(merged.equals(reference)).toBe(true);

  const reversed = sketchOf(b, 10).union(sketchOf(a, 14));
  expect(reversed.p).toBe(10);
  expect(reversed.equals(reference)).toBe(true);
});

// The sparse buffer is sized against the dense registers, so it shrinks with
// precision: 192 entries at p=10 against 3072 at p=14. Fifty keys a side stay
// inside that, so the merge stays sparse and keeps counting exactly.
test("folding a union carries sparse operands with it", () => {
  const a = keys("a", 50);
  const b = keys("b", 50);
  const merged = sketchOf(a, 14).union(sketchOf(b, 10));

  expect(merged.p).toBe(10);
  expect(merged.equals(sketchOf([...a, ...b], 10))).toBe(true);
  expect(merged.count()).toBe(100);
});

test("folding a union mixes representations across precisions", () => {
  const a = keys("a", 100);
  const b = keys("b", 5000);
  const reference = sketchOf([...a, ...b], 8);

  expect(sketchOf(a, 14).union(sketchOf(b, 8)).equals(reference)).toBe(true);
  expect(sketchOf(b, 8).union(sketchOf(a, 14)).equals(reference)).toBe(true);
});

// Sketches seeded differently hash the same key to different registers, so
// merging them would silently produce a count belonging to neither.
test("union rejects a sketch built with a different seed", () => {
  const a = sketchOf(keys("a", 100));
  const b = sketchOf(keys("b", 100), 14, 7);
  expect(() => a.union(b)).toThrow(ParamError);
});
