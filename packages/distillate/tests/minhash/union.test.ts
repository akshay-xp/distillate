import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { MinHash } from "../../src/minhash/minhash.js";

const keys = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

function sketchOf(items: readonly string[], k = 128, seed = 0): MinHash {
  const sketch = new MinHash({ k, seed });
  for (const item of items) sketch.add(item);
  return sketch;
}

test("the union of two sketches is the sketch of the union set", () => {
  const a = keys("a", 300);
  const b = [...keys("a", 100), ...keys("b", 300)];
  const left = sketchOf(a);
  const right = sketchOf(b);
  const leftBefore = left.signature();
  const rightBefore = right.signature();

  expect(left.union(right).equals(sketchOf([...a, ...b]))).toBe(true);
  expect(left.signature()).toEqual(leftBefore);
  expect(right.signature()).toEqual(rightBefore);
});

test("a union with an empty sketch changes nothing", () => {
  const items = keys("e", 50);
  expect(sketchOf(items).union(new MinHash()).equals(sketchOf(items))).toBe(
    true,
  );
  expect(new MinHash().union(new MinHash()).isEmpty).toBe(true);
});

test("equals compares k, seed and slots", () => {
  const items = keys("q", 50);
  expect(sketchOf(items).equals(sketchOf(items))).toBe(true);
  expect(sketchOf(items).equals(sketchOf(items, 64))).toBe(false);
  expect(sketchOf(items).equals(sketchOf(items, 128, 1))).toBe(false);
  expect(sketchOf(items).equals(sketchOf(keys("r", 50)))).toBe(false);
});

test("union and jaccard refuse sketches that hash differently", () => {
  const base = sketchOf(["x"]);
  for (const other of [sketchOf(["x"], 64), sketchOf(["x"], 128, 1)]) {
    expect(() => base.union(other)).toThrow(ParamError);
    expect(() => base.jaccard(other)).toThrow(ParamError);
  }
});
