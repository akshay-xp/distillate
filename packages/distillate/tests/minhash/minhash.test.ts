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

describe("signature", () => {
  test("does not depend on insertion order", () => {
    const items = keys("o", 500);
    const forward = sketchOf(items);
    const backward = sketchOf([...items].reverse());
    expect(backward.signature()).toEqual(forward.signature());
  });

  test("a set smaller than k has every slot densified", () => {
    expect(sketchOf(["x", "y", "z"]).signature()).not.toContain(0xffffffff);
  });

  test("is a copy", () => {
    const sketch = sketchOf(["x", "y", "z"]);
    const first = sketch.signature();
    const kept = Array.from(first);
    first.fill(0);
    expect(Array.from(sketch.signature())).toEqual(kept);
  });

  test("mutating a copy leaves later estimates alone", () => {
    const a = sketchOf(["x", "y", "z"]);
    const b = sketchOf(["x", "y", "w"]);
    const before = a.jaccard(b);
    a.signature().fill(0);
    expect(a.jaccard(b)).toBe(before);
  });

  test("an empty sketch has nothing to densify from", () => {
    expect(Array.from(new MinHash({ k: 4 }).signature())).toEqual([
      0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
    ]);
  });
});

describe("densification", () => {
  // At k 4096 with one filled slot each densification costs hundreds of ms,
  // so 20 reads only fit the budget if all but the first reuse it.
  test("is paid once per change, not once per read", () => {
    const a = sketchOf(["x"], 4096);
    const b = sketchOf(["x"], 4096);
    a.jaccard(b);

    const start = performance.now();
    for (let i = 0; i < 10; i++) a.jaccard(b);
    for (let i = 0; i < 10; i++) a.signature();
    expect(performance.now() - start).toBeLessThan(100);
  });

  test("follows an add that changes a slot", () => {
    const a = sketchOf(["x"], 64);
    const b = sketchOf(["x", "y"], 64);
    expect(a.jaccard(b)).toBeLessThan(1);
    a.add("y");
    expect(a.jaccard(b)).toBe(1);
    expect(a.signature()).toEqual(b.signature());
  });

  test("starts fresh in a union and a decoded sketch", () => {
    const a = sketchOf(["x"], 64);
    const b = sketchOf(["y"], 64);
    a.jaccard(b);
    const both = sketchOf(["x", "y"], 64).signature();
    expect(a.union(b).signature()).toEqual(both);
    expect(MinHash.fromBytes(a.union(b).toBytes()).signature()).toEqual(both);
  });
});

describe("create and from", () => {
  test("create sizes k from the target error", () => {
    expect(MinHash.create(0.05).k).toBe(100);
  });

  test("from records every key", () => {
    const items = keys("f", 400);
    expect(MinHash.from(items, 0.05).equals(sketchOf(items, 100))).toBe(true);
  });
});
