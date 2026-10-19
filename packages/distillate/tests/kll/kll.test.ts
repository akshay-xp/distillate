import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { KllSketch } from "../../src/kll/kll.js";
import { kllRankError, kllSizing } from "../../src/kll/sizing.js";

describe("construction", () => {
  test("defaults to k 200 and reads empty", () => {
    const sketch = new KllSketch();
    expect(sketch.k).toBe(200);
    expect(sketch.count).toBe(0);
    expect(sketch.isEmpty).toBe(true);
    expect(sketch.retained).toBe(0);
    expect(sketch.numLevels).toBe(1);
    expect(sketch.min).toBeNaN();
    expect(sketch.max).toBeNaN();
    expect(sketch.quantile(0.5)).toBeNaN();
    expect(sketch.quantiles([0.1, 0.9])).toEqual([Number.NaN, Number.NaN]);
    expect(sketch.rank(1)).toBeNaN();
    expect(sketch.normalizedRankError()).toBe(kllRankError(200, false));
    expect(sketch.normalizedRankError(true)).toBe(kllRankError(200, true));
  });

  test("create takes k from kllSizing", () => {
    expect(KllSketch.create(0.0133).k).toBe(kllSizing(0.0133).k);
  });

  test("rejects a k outside [8, 65535] or fractional, and a seed outside u32", () => {
    for (const params of [
      { k: 7 },
      { k: 65_536 },
      { k: 200.5 },
      { seed: -1 },
      { seed: 2 ** 32 },
    ]) {
      expect(() => new KllSketch(params)).toThrow(ParamError);
    }
  });

  test("quantile rejects q outside [0, 1]", () => {
    const sketch = new KllSketch();
    for (const q of [-0.1, 1.1, Number.NaN]) {
      expect(() => sketch.quantile(q)).toThrow(ParamError);
    }
  });
});

// 150 values from 50 distinct integers, each repeated, in a fixed scrambled
// order: below k = 200, so nothing has compacted.
const scrambled = Array.from({ length: 150 }, (_, i) => (i * 37) % 50);
const sortedValues = [...scrambled].sort((a, b) => a - b);

describe("exact below k", () => {
  test("quantiles and ranks match a sorted array, repeats included", () => {
    const sketch = new KllSketch();
    for (const v of scrambled) sketch.add(v);
    expect(sketch.count).toBe(150);
    expect(sketch.min).toBe(0);
    expect(sketch.max).toBe(49);

    const qs = Array.from({ length: 101 }, (_, i) => i / 100);
    for (const q of qs) {
      expect(sketch.quantile(q), `q ${String(q)}`).toBe(
        sortedValues[Math.floor(q * 149)],
      );
    }
    expect(sketch.quantiles(qs)).toEqual(qs.map((q) => sketch.quantile(q)));

    for (const x of [-1, ...new Set(sortedValues), 50]) {
      const atOrBelow = sortedValues.filter((v) => v <= x).length;
      expect(sketch.rank(x), `x ${String(x)}`).toBe(atOrBelow / 150);
    }
  });

  test("refuses NaN, and orders infinities and signed zeros", () => {
    const sketch = new KllSketch();
    expect(() => {
      sketch.add(Number.NaN);
    }).toThrow(ParamError);
    expect(sketch.isEmpty).toBe(true);
    for (const v of [-Infinity, Infinity, -0, 0]) sketch.add(v);
    expect(sketch.min).toBe(-Infinity);
    expect(sketch.max).toBe(Infinity);
    expect(sketch.rank(0)).toBe(3 / 4);
    expect(sketch.rank(-0)).toBe(3 / 4);
    expect(() => sketch.rank(Number.NaN)).toThrow(ParamError);
  });
});
