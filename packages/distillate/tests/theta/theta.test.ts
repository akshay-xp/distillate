import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { thetaSizing } from "../../src/theta/sizing.js";
import { ThetaSketch } from "../../src/theta/theta.js";

const keys = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

describe("construction", () => {
  test("defaults to k 4096, seed 0, empty and exact", () => {
    const sketch = new ThetaSketch();
    expect(sketch.k).toBe(4096);
    expect(sketch.seed).toBe(0);
    expect(sketch.isEmpty).toBe(true);
    expect(sketch.count()).toBe(0);
    expect(sketch.theta).toBe(1);
    expect(sketch.isEstimating).toBe(false);
  });

  test("rejects a k that is not a power of two in [16, 2^26] and a seed outside u32", () => {
    for (const params of [{ k: 100 }, { k: 8 }, { k: 2 ** 27 }, { seed: -1 }]) {
      expect(() => new ThetaSketch(params)).toThrow(ParamError);
    }
  });

  test("create takes k from thetaSizing", () => {
    expect(ThetaSketch.create(0.01).k).toBe(thetaSizing(0.01).k);
  });

  test("from counts any iterable of keys", () => {
    const set = new Set(keys("from", 300));
    function* generate(): Generator<string> {
      yield* set;
    }
    expect(ThetaSketch.from(set, 0.05).count()).toBe(300);
    expect(ThetaSketch.from(generate(), 0.05).count()).toBe(300);
  });
});

describe("exact mode", () => {
  test("counts distinct keys exactly below k, repeats included", () => {
    const sketch = new ThetaSketch({ k: 1024 });
    for (let round = 0; round < 3; round++) {
      for (const key of keys("x", 1000)) sketch.add(key);
    }
    expect(sketch.isEmpty).toBe(false);
    expect(sketch.count()).toBe(1000);
    expect(sketch.retained).toBe(1000);
    expect(sketch.lowerBound(2)).toBe(1000);
    expect(sketch.upperBound(2)).toBe(1000);
  });
});

describe("past k", () => {
  test("samples below theta and estimates within the error, bounds included", () => {
    const sketch = new ThetaSketch({ k: 256 });
    for (const key of keys("big", 100_000)) sketch.add(key);
    expect(sketch.isEstimating).toBe(true);
    expect(sketch.theta).toBeLessThan(1);
    expect(sketch.retained).toBe(256);
    expect(Math.abs(sketch.count() / 100_000 - 1)).toBeLessThan(3 / 16);
    expect(sketch.lowerBound(3)).toBeLessThanOrEqual(100_000);
    expect(sketch.upperBound(3)).toBeGreaterThanOrEqual(100_000);
  });

  test("is exact at k distinct keys and estimates at one more", () => {
    const sketch = new ThetaSketch({ k: 256 });
    for (const key of keys("edge", 256)) sketch.add(key);
    expect(sketch.isEstimating).toBe(false);
    expect(sketch.count()).toBe(256);
    sketch.add("edge:256");
    expect(sketch.isEstimating).toBe(true);
    expect(sketch.retained).toBe(256);
  });
});
