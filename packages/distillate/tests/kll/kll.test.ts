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
