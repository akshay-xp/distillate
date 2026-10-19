import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { KllSketch } from "../../src/kll/kll.js";
import { kllRankError, kllSizing } from "../../src/kll/sizing.js";
import { shuffled, worstRankError } from "../helpers/kll.js";

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

describe("cdf and pmf", () => {
  const oneToTen = (): KllSketch => {
    const sketch = new KllSketch();
    for (let v = 1; v <= 10; v++) sketch.add(v);
    return sketch;
  };

  test("give the fraction at or below each split, and between them", () => {
    const sketch = oneToTen();
    expect(sketch.cdf([3, 7])).toEqual([0.3, 0.7, 1]);
    const pmf = sketch.pmf([3, 7]);
    [0.3, 0.4, 0.3].forEach((p, i) => {
      expect(pmf[i]).toBeCloseTo(p, 12);
    });
    expect(sketch.cdf([])).toEqual([1]);
    expect(sketch.pmf([])).toEqual([1]);
  });

  test("refuse splits that are not strictly increasing or hold NaN", () => {
    const sketch = oneToTen();
    for (const splits of [
      [3, 3],
      [5, 2],
      [1, Number.NaN],
    ]) {
      expect(() => sketch.cdf(splits)).toThrow(ParamError);
      expect(() => sketch.pmf(splits)).toThrow(ParamError);
    }
  });

  test("read NaN while empty", () => {
    expect(new KllSketch().cdf([1, 2])).toEqual([
      Number.NaN,
      Number.NaN,
      Number.NaN,
    ]);
  });
});

describe("weighted adds", () => {
  test("answer as repeated adds while nothing has compacted", () => {
    const weighted = new KllSketch();
    weighted.add(5, 6);
    weighted.add(1, 1);
    weighted.add(9, 3);
    const repeated = new KllSketch();
    for (const v of [5, 5, 5, 5, 5, 5, 1, 9, 9, 9]) repeated.add(v);

    expect(weighted.count).toBe(10);
    expect(weighted.min).toBe(repeated.min);
    expect(weighted.max).toBe(repeated.max);
    for (let i = 0; i <= 20; i++) {
      const q = i / 20;
      expect(weighted.quantile(q), `q ${String(q)}`).toBe(repeated.quantile(q));
    }
    for (const x of [0, 1, 5, 9, 10]) {
      expect(weighted.rank(x), `x ${String(x)}`).toBe(repeated.rank(x));
    }
    // 6 is 110 in binary, so one item each at levels 1 and 2.
    expect(weighted.numLevels).toBe(3);
    expect(weighted.retained).toBe(5);
  });

  test("refuse a count that is not a positive safe integer", () => {
    const sketch = new KllSketch();
    for (const count of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      expect(() => {
        sketch.add(1, count);
      }).toThrow(ParamError);
    }
    expect(sketch.isEmpty).toBe(true);
  });
});

describe("past k", () => {
  const n = 100_000;
  const stream = shuffled(n);
  const sorted = Array.from({ length: n }, (_, i) => i);

  test("answers within the CDF bound, with count, min and max exact", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const sketch = new KllSketch({ seed });
      for (const v of stream) sketch.add(v);
      expect(sketch.count).toBe(n);
      expect(sketch.min).toBe(0);
      expect(sketch.max).toBe(n - 1);
      expect(
        worstRankError(sketch, sorted),
        `seed ${String(seed)}`,
      ).toBeLessThanOrEqual(sketch.normalizedRankError(true));
    }
  });

  test("holds at most 3k + 8 per level items, in about log2(n) levels", () => {
    const sketch = new KllSketch({ seed: 1 });
    let added = 0;
    for (const target of [1e3, 1e4, 1e5, 1e6]) {
      for (; added < target; added++) sketch.add((added * 7919) % 1_000_003);
      expect(sketch.retained).toBeLessThanOrEqual(
        3 * 200 + 8 * sketch.numLevels,
      );
      expect(sketch.numLevels).toBeLessThanOrEqual(
        Math.ceil(Math.log2(target)) + 1,
      );
    }
  });

  test("weighted adds stay within the bound", () => {
    const sketch = new KllSketch({ seed: 3 });
    for (let i = 0; i < 10_000; i++) sketch.add(i % 100, 7);
    expect(sketch.count).toBe(70_000);
    const exact = Array.from({ length: 100 }, (_, v) => v).flatMap((v) =>
      Array<number>(700).fill(v),
    );
    expect(worstRankError(sketch, exact)).toBeLessThanOrEqual(
      sketch.normalizedRankError(true),
    );
  });

  test("an unseeded sketch draws its own seed and compacts", () => {
    const sketch = new KllSketch();
    for (let i = 0; i < 10_000; i++) sketch.add(i);
    expect(sketch.count).toBe(10_000);
    expect(sketch.numLevels).toBeGreaterThan(1);
  });
});
