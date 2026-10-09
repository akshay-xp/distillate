import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import { cubicMapping } from "../../src/ddsketch/mapping.js";
import { rng } from "../helpers/frequency.js";
import {
  exactQuantile,
  expectWithin,
  lognormalValues,
} from "../helpers/quantile.js";

const QS = [0.01, 0.1, 0.5, 0.9, 0.99];

describe("create", () => {
  test("reports the accuracy it was built for and the log mapping by default", () => {
    const sketch = DDSketch.create(0.01);
    expect(sketch.relativeAccuracy).toBe(0.01);
    expect(sketch.mapping.kind).toBe("log");
  });

  test("takes a mapping factory", () => {
    expect(DDSketch.create(0.01, { mapping: cubicMapping }).mapping.kind).toBe(
      "cubic",
    );
  });

  test("rejects an accuracy outside (0, 1)", () => {
    for (const bad of [0, 1, -0.1, Number.NaN]) {
      expect(() => DDSketch.create(bad)).toThrow(ParamError);
    }
  });
});

describe("summaries", () => {
  test("count, sum, min and max are exact", () => {
    const sketch = DDSketch.create(0.01);
    for (const v of [3, 1, 2]) sketch.add(v);
    expect(sketch.count).toBe(3);
    expect(sketch.sum).toBe(6);
    expect(sketch.min).toBe(1);
    expect(sketch.max).toBe(3);
  });

  test("an empty sketch has no min or max", () => {
    const sketch = DDSketch.create(0.01);
    expect(sketch.count).toBe(0);
    expect(sketch.sum).toBe(0);
    expect(sketch.min).toBeNaN();
    expect(sketch.max).toBeNaN();
  });
});

describe("add", () => {
  test("rejects values and counts it cannot hold, recording nothing", () => {
    const sketch = DDSketch.create(0.01);
    const tooBig = sketch.mapping.maxIndexableValue * 2;
    for (const bad of [Number.NaN, Infinity, -Infinity, tooBig, -tooBig]) {
      expect(() => {
        sketch.add(bad);
      }).toThrow(ParamError);
    }
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      expect(() => {
        sketch.add(1, bad);
      }).toThrow(ParamError);
    }
    expect(sketch.count).toBe(0);
  });
});

describe("quantile", () => {
  test("is within the relative accuracy of the exact value", () => {
    const values = lognormalValues(1, 1000);
    const sketch = DDSketch.create(0.01);
    for (const v of values) sketch.add(v);
    for (const q of QS) {
      expectWithin(sketch.quantile(q), exactQuantile(values, q), 0.01);
    }
  });

  test("returns min and max exactly at the ends", () => {
    const values = lognormalValues(2, 100);
    const sketch = DDSketch.create(0.01);
    for (const v of values) sketch.add(v);
    expect(sketch.quantile(0)).toBe(sketch.min);
    expect(sketch.quantile(1)).toBe(sketch.max);
  });

  test("is NaN on an empty sketch", () => {
    expect(DDSketch.create(0.01).quantile(0.5)).toBeNaN();
  });

  test("rejects a q outside [0, 1]", () => {
    const sketch = DDSketch.create(0.01);
    sketch.add(1);
    for (const bad of [-0.1, 1.1, Number.NaN]) {
      expect(() => sketch.quantile(bad)).toThrow(ParamError);
    }
  });
});

describe("negative values and zero", () => {
  test("a mixed-sign stream keeps the guarantee", () => {
    const sign = rng(3);
    const values = lognormalValues(4, 1000).map((v) => (sign() < 0.5 ? -v : v));
    for (let i = 0; i < 50; i++) values.push(0);
    const sketch = DDSketch.create(0.01);
    for (const v of values) sketch.add(v);
    for (const q of QS) {
      expectWithin(sketch.quantile(q), exactQuantile(values, q), 0.01);
    }
    expect(sketch.min).toBe(Math.min(...values));
    expect(sketch.max).toBe(Math.max(...values));
  });

  test("a fractional rank among negatives rounds down, like positives", () => {
    // Rank 1.2 is the second value, -2. Indexing the negatives from the far
    // end as count - 1 - rank would round it up to the third, -1.
    const sketch = DDSketch.from([-3, -2, -1], 0.01);
    expectWithin(sketch.quantile(0.6), -2, 0.01);
  });

  test("magnitudes too small to index count as zero", () => {
    const sketch = DDSketch.create(0.01);
    const tiny = sketch.mapping.minIndexableValue / 2;
    for (const v of [tiny, -tiny, 0]) sketch.add(v);
    expect(sketch.count).toBe(3);
    expect(sketch.quantile(0.5)).toBe(0);
  });
});

describe("weighted add", () => {
  test("add(v, 3) is three unit adds", () => {
    const values = lognormalValues(5, 200);
    const weighted = DDSketch.create(0.01);
    const repeated = DDSketch.create(0.01);
    for (const v of values) {
      weighted.add(v, 3);
      for (let i = 0; i < 3; i++) repeated.add(v);
    }
    expect(weighted.count).toBe(600);
    expect(weighted.count).toBe(repeated.count);
    expect(weighted.min).toBe(repeated.min);
    expect(weighted.max).toBe(repeated.max);
    expectWithin(weighted.sum, repeated.sum, 1e-12);
    for (let q = 0; q <= 1; q += 0.1) {
      expect(weighted.quantile(q)).toBe(repeated.quantile(q));
    }
  });
});

describe("batch", () => {
  test("quantiles(qs) is quantile per entry", () => {
    const sketch = DDSketch.from(lognormalValues(6, 300), 0.01);
    const qs = [0, 0.5, 0.99, 1];
    expect(sketch.quantiles(qs)).toEqual(qs.map((q) => sketch.quantile(q)));
  });

  test("from(values) is create plus adding each value", () => {
    const values = lognormalValues(7, 300);
    const built = DDSketch.from(values, 0.01, { mapping: cubicMapping });
    const added = DDSketch.create(0.01, { mapping: cubicMapping });
    for (const v of values) added.add(v);
    expect(built.mapping.kind).toBe("cubic");
    expect([built.count, built.sum, built.min, built.max]).toEqual([
      added.count,
      added.sum,
      added.min,
      added.max,
    ]);
    expect(built.quantiles(QS)).toEqual(added.quantiles(QS));
  });
});
