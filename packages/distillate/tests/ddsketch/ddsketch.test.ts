import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import { bitwiseMapping, cubicMapping } from "../../src/ddsketch/mapping.js";
import {
  collapsingHighestStore,
  collapsingLowestStore,
  denseStore,
  sparseStore,
} from "../../src/ddsketch/store.js";
import { rng } from "../helpers/frequency.js";
import {
  exactQuantile,
  exactQuantiles,
  exactWeightedQuantile,
  expectWithin,
  lognormalValues,
} from "../helpers/quantile.js";

const QS = [0.01, 0.1, 0.5, 0.9, 0.99];

describe("create", () => {
  // The default is the fastest mapping, as sketches-java's fast sketch is:
  // its bin is integer arithmetic on the float's bits.
  test("reports the accuracy it was built for and the bitwise mapping by default", () => {
    const sketch = DDSketch.create(0.01);
    expect(sketch.relativeAccuracy).toBe(0.01);
    expect([sketch.mapping.kind, sketch.mapping.gamma]).toEqual([
      "linear",
      bitwiseMapping(0.01).gamma,
    ]);
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
  // Below a total weight of 1, q * (count - 1) floors to rank -1. That still
  // reads the lowest value: the walk from the far end lands on the largest
  // negative magnitude, and an empty side clamps to min. Clamping the rank to
  // 0 instead would read the negative side's smallest magnitude.
  test.each<[string, [number, number][], number]>([
    [
      "zero and positive",
      [
        [0, 0.3],
        [5, 0.3],
      ],
      0,
    ],
    [
      "mixed signs",
      [
        [-5, 0.2],
        [-1, 0.2],
        [3, 0.2],
      ],
      -5,
    ],
  ])("a total weight below 1 reads the lowest value: %s", (_, adds, lowest) => {
    const sketch = DDSketch.create(0.01);
    for (const [value, count] of adds) sketch.add(value, count);
    expectWithin(sketch.quantile(0.5), lowest, 0.01);
  });

  test("fractional weights on negatives rank by cumulative weight", () => {
    const sketch = DDSketch.create(0.01);
    sketch.add(-9, 1.27);
    sketch.add(-7, 1.96);
    sketch.add(1, 0.87);
    expectWithin(sketch.quantile(0.5), -9, 0.01);
  });

  // The rank promise holds for any weights: below a total of 1, fractional,
  // or whole, on either sign and through every store.
  test.each([
    denseStore(),
    sparseStore(),
    collapsingLowestStore(4096),
    collapsingHighestStore(4096),
  ])(
    "every weighted quantile is exact to the bin on a $kind store",
    (store) => {
      const next = rng(41);
      for (let t = 0; t < 3000; t++) {
        const n = 1 + Math.floor(next() * 6);
        const weight = (): number =>
          t % 3 === 0
            ? next() * (0.9 / n) + 0.001
            : t % 3 === 1
              ? next() * 2 + 0.05
              : 1 + Math.floor(next() * 3);
        const points = Array.from(
          { length: n },
          () => [Math.round(next() * 20 - 10) || 1, weight()] as const,
        );
        const sketch = DDSketch.create(0.01, { store });
        for (const [value, w] of points) sketch.add(value, w);
        for (const q of [0.01, 0.3, 0.5, 0.7, 0.99]) {
          expectWithin(
            sketch.quantile(q),
            exactWeightedQuantile(points, q),
            0.01,
          );
        }
      }
    },
  );
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

describe("bounded memory", () => {
  const ALL_QS = [0, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999, 1];
  // About 1,600 bins at 0.01, so 256 collapses.
  const values = lognormalValues(23, 100_000).map((v) => v ** 4);
  const exact = exactQuantiles(values, ALL_QS);

  // 4096 bitwise bins span 64 powers of two at 1%, about 19 orders of
  // magnitude, the range 2048 log bins covered.
  test("defaults to collapsing-lowest at 4096 bins", () => {
    const { store } = DDSketch.create(0.01);
    expect([store.kind, store.maxBins]).toEqual(["collapsingLowest", 4096]);
  });

  test("collapsing-lowest keeps the bound above the collapsed range", () => {
    const sketch = DDSketch.from(values, 0.01, {
      store: collapsingLowestStore(256),
    });
    const indices = values.map((v) => sketch.mapping.index(v));
    const floor = Math.max(...indices) - 256 + 1;
    let collapsedSide = 0;
    for (const [i, q] of ALL_QS.entries()) {
      const want = exact[i] ?? Number.NaN;
      if (sketch.mapping.index(want) > floor) {
        expectWithin(sketch.quantile(q), want, 0.01);
      } else {
        collapsedSide++;
      }
    }
    expect(collapsedSide).toBeGreaterThan(0);
  });

  test("collapsing-highest keeps the bound below the collapsed range", () => {
    const sketch = DDSketch.from(values, 0.01, {
      store: collapsingHighestStore(256),
    });
    const indices = values.map((v) => sketch.mapping.index(v));
    const ceiling = Math.min(...indices) + 256 - 1;
    let collapsedSide = 0;
    for (const [i, q] of ALL_QS.entries()) {
      const want = exact[i] ?? Number.NaN;
      if (sketch.mapping.index(want) < ceiling) {
        expectWithin(sketch.quantile(q), want, 0.01);
      } else {
        collapsedSide++;
      }
    }
    expect(collapsedSide).toBeGreaterThan(0);
  });
});
