import { describe, expect, test, vi } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { ThetaSketch } from "../../src/theta/theta.js";
import { SMALL, typedArrayBytesDuring } from "../helpers/memory.js";

// Keys `from` to `to - 1`.
const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from }, (_, i) => `key:${String(from + i)}`);

function sketchOf(items: readonly string[], k = 1024, seed = 0): ThetaSketch {
  const sketch = new ThetaSketch({ k, seed });
  for (const item of items) sketch.add(item);
  return sketch;
}

const A = range(0, 600);
const B = range(400, 1000);

describe("union", () => {
  test("is the sketch of the union set and leaves both inputs as they were", () => {
    const a = sketchOf(A);
    const b = sketchOf(B);
    const union = a.union(b);
    expect(union.equals(sketchOf(range(0, 1000)))).toBe(true);
    expect(union.count()).toBe(1000);
    expect(a.count()).toBe(600);
    expect(b.count()).toBe(600);
    expect(a.equals(sketchOf(A))).toBe(true);
    expect(b.equals(sketchOf(B))).toBe(true);
  });

  test("refuses a sketch with a different seed", () => {
    expect(() => sketchOf(A).union(sketchOf(B, 1024, 1))).toThrow(ParamError);
  });

  test("gives a sketch that takes more keys", () => {
    const union = sketchOf(A).union(sketchOf(B));
    union.add("key:1000");
    expect(union.count()).toBe(1001);
  });
});

describe("union order and grouping", () => {
  // Mixed k, and a and c cut before b's larger sample joins: with the larger
  // k kept, (a ∪ b) ∪ c and a ∪ (b ∪ c) would cut at different points.
  test("give the same sketch, across k", () => {
    const a = sketchOf(range(0, 50_000), 256);
    const b = sketchOf(range(30_000, 80_000), 1024);
    const c = sketchOf(range(60_000, 110_000), 256);
    const left = a.union(b).union(c);
    const right = a.union(b.union(c));
    const rotated = c.union(a).union(b);
    expect(left.equals(right)).toBe(true);
    expect(left.equals(rotated)).toBe(true);
    for (const union of [left, right, rotated]) {
      expect(union.k).toBe(256);
      expect(Math.abs(union.count() / 110_000 - 1)).toBeLessThan(3 / 16);
    }
  });
});

describe("intersect", () => {
  test("is the sketch of the keys both sets hold", () => {
    const both = sketchOf(A).intersect(sketchOf(B));
    expect(both.equals(sketchOf(range(400, 600)))).toBe(true);
    expect(both.count()).toBe(200);
  });

  test("of disjoint sets reads zero, with an upper bound above it", () => {
    const a = sketchOf(range(0, 100_000), 256);
    const b = sketchOf(range(100_000, 200_000), 256);
    const both = a.intersect(b);
    expect(both.count()).toBe(0);
    expect(both.isEstimating).toBe(true);
    expect(both.lowerBound(2)).toBe(0);
    expect(both.upperBound(2)).toBeGreaterThan(0);
  });

  test("refuses a sketch with a different seed", () => {
    expect(() => sketchOf(A).intersect(sketchOf(B, 1024, 1))).toThrow(
      ParamError,
    );
  });
});

describe("difference", () => {
  test("is the sketch of the keys only this side holds", () => {
    const a = sketchOf(A);
    const b = sketchOf(B);
    const onlyA = a.difference(b);
    expect(onlyA.equals(sketchOf(range(0, 400)))).toBe(true);
    expect(onlyA.count()).toBe(400);
    expect(b.difference(a).count()).toBe(400);
  });

  test("chains with the other operations, and the result takes more keys", () => {
    const c = sketchOf(range(2000, 2100));
    const d = sketchOf(range(450, 500));
    const result = sketchOf(A).intersect(sketchOf(B)).union(c).difference(d);
    expect(result.count()).toBe(250);
    result.add("key:5000");
    expect(result.count()).toBe(251);
  });

  test("refuses a sketch with a different seed", () => {
    expect(() => sketchOf(A).difference(sketchOf(B, 1024, 1))).toThrow(
      ParamError,
    );
  });
});

describe("memory", () => {
  test("a union allocates for the hashes its inputs hold, not for k", () => {
    const a = sketchOf(["a", "b", "c"], 2 ** 26);
    const b = sketchOf(["d"], 2 ** 26);
    a.count();
    b.count();
    const { value: union, bytes } = typedArrayBytesDuring(() => a.union(b));
    expect(union.count()).toBe(4);
    expect(bytes).toBeLessThan(SMALL);
  });

  // b is exact, so its theta is the whole range and all of a's 4096 retained
  // hashes survive the cut by theta; only k may cut them to 16.
  test("a mixed-k difference holds at most the smaller k", () => {
    const a = sketchOf(range(0, 6000), 4096);
    const b = sketchOf(range(0, 5), 16);
    a.count();
    b.count();
    const { value: onlyA, bytes } = typedArrayBytesDuring(() =>
      a.difference(b),
    );
    expect(onlyA.equals(sketchOf(range(5, 6000), 16))).toBe(true);
    // A 32-slot table (256 B) and 16 hashes (128 B).
    expect(bytes).toBeLessThan(1024);
  });

  test.each<[string, (x: ThetaSketch, y: ThetaSketch) => ThetaSketch]>([
    ["union", (x, y) => x.union(y)],
    ["intersect", (x, y) => x.intersect(y)],
    ["difference", (x, y) => x.difference(y)],
  ])("%s gives a result read without allocating or sorting", (_, operate) => {
    const x = sketchOf(range(0, 100_000), 4096);
    const y = sketchOf(range(50_000, 150_000), 4096);
    x.count();
    y.count();
    const result = operate(x, y);
    const sort = vi.spyOn(Float64Array.prototype, "sort");
    expect(typedArrayBytesDuring(() => result.count()).bytes).toBe(0);
    expect(sort).not.toHaveBeenCalled();
    sort.mockRestore();
  });

  // The result keeps its merge output as its sample, which later adds and
  // rebuilds must be able to outgrow.
  test("a result that is read, takes keys and joins another union matches the streamed sketch", () => {
    const u = sketchOf(range(0, 30_000), 256).union(
      sketchOf(range(20_000, 50_000), 256),
    );
    u.count();
    for (const key of range(50_000, 60_000)) u.add(key);
    const joined = u.union(sketchOf(range(55_000, 70_000), 256));
    expect(joined.equals(sketchOf(range(0, 70_000), 256))).toBe(true);
  });
});
