import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { MinHash } from "../../src/minhash/minhash.js";

describe("construction", () => {
  test("defaults to 128 slots and seed 0", () => {
    const sketch = new MinHash();
    expect(sketch.k).toBe(128);
    expect(sketch.seed).toBe(0);
    expect(sketch.isEmpty).toBe(true);
  });

  test("reports the worst-case Jaccard standard error", () => {
    expect(new MinHash({ k: 256, seed: 7 }).standardError).toBe(0.5 / 16);
  });

  test.each([1, 4097, 2.5, Number.NaN])("rejects k = %s", (k) => {
    expect(() => new MinHash({ k })).toThrow(ParamError);
  });

  test.each([-1, 2 ** 32])("rejects seed = %s", (seed) => {
    expect(() => new MinHash({ seed })).toThrow(ParamError);
  });
});

const keys = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

function sketchOf(items: readonly string[], k = 128): MinHash {
  const sketch = new MinHash({ k });
  for (const item of items) sketch.add(item);
  return sketch;
}

describe("add and jaccard", () => {
  test("one add leaves the sketch non-empty", () => {
    const sketch = new MinHash();
    sketch.add("alice");
    expect(sketch.isEmpty).toBe(false);
  });

  test("identical sets are fully similar", () => {
    const items = keys("same", 1000);
    expect(sketchOf(items).jaccard(sketchOf(items))).toBe(1);
  });

  test("two empty sketches are identical; empty against non-empty shares nothing", () => {
    expect(new MinHash().jaccard(new MinHash())).toBe(1);
    expect(new MinHash().jaccard(sketchOf(["alice"]))).toBe(0);
    expect(sketchOf(["alice"]).jaccard(new MinHash())).toBe(0);
  });

  test("disjoint sets estimate near 0", () => {
    const a = sketchOf(keys("a", 10_000));
    const b = sketchOf(keys("b", 10_000));
    expect(a.jaccard(b)).toBeLessThan(3 * a.standardError);
  });

  test("half-overlapping sets estimate near 0.5", () => {
    // |A ∩ B| = 10k, |A ∪ B| = 20k.
    const shared = keys("s", 10_000);
    const a = sketchOf([...shared, ...keys("a", 5000)]);
    const b = sketchOf([...shared, ...keys("b", 5000)]);
    expect(Math.abs(a.jaccard(b) - 0.5)).toBeLessThan(4 * a.standardError);
  });

  test("a set far smaller than k is fully similar to itself through densification", () => {
    const items = ["x", "y", "z"];
    expect(sketchOf(items).jaccard(sketchOf(items))).toBe(1);
  });
});
