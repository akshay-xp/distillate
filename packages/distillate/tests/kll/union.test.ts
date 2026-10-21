import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { KllSketch } from "../../src/kll/kll.js";
import {
  balanced,
  mergeShapes,
  shuffled,
  worstRankError,
} from "../helpers/kll.js";

// Every quantile on a 0.01 grid and every rank at the values and one either
// side: what "answers alike" means here.
function expectSameAnswers(
  actual: KllSketch,
  expected: KllSketch,
  values: readonly number[],
): void {
  expect(actual.count).toBe(expected.count);
  expect(actual.min).toBe(expected.min);
  expect(actual.max).toBe(expected.max);
  for (let i = 0; i <= 100; i++) {
    const q = i / 100;
    expect(actual.quantile(q), `q ${String(q)}`).toBe(expected.quantile(q));
  }
  for (const x of [-1, ...values, Math.max(...values) + 1]) {
    expect(actual.rank(x), `x ${String(x)}`).toBe(expected.rank(x));
  }
}

describe("union below k", () => {
  const values = shuffled(130);
  const build = (): { a: KllSketch; b: KllSketch; both: KllSketch } => {
    const a = new KllSketch({ seed: 1 });
    const b = new KllSketch({ seed: 2 });
    const both = new KllSketch({ seed: 3 });
    values.forEach((v, i) => {
      (i < 60 ? a : b).add(v);
      both.add(v);
    });
    b.add(7, 6);
    b.add(9, 3);
    both.add(7, 6);
    both.add(9, 3);
    return { a, b, both };
  };

  test("answers as one sketch fed both streams", () => {
    const { a, b, both } = build();
    expectSameAnswers(a.union(b), both, values);
    expectSameAnswers(b.union(a), both, values);
  });

  test("leaves both inputs as they were", () => {
    const { a, b } = build();
    const before = [a, b].map((s) => [s.count, s.retained, s.quantile(0.5)]);
    a.union(b);
    expect([a, b].map((s) => [s.count, s.retained, s.quantile(0.5)])).toEqual(
      before,
    );
  });

  test("with an empty side answers as the other", () => {
    const { a } = build();
    const empty = new KllSketch();
    const aValues = values.slice(0, 60);
    expectSameAnswers(a.union(empty), a, aValues);
    expectSameAnswers(empty.union(a), a, aValues);
    const none = empty.union(new KllSketch());
    expect(none.isEmpty).toBe(true);
    expect(none.quantile(0.5)).toBeNaN();
    expect(none.min).toBeNaN();
  });
});

const ascending = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => i);

function sketchOf(
  values: readonly number[],
  k: number,
  seed: number,
): KllSketch {
  const sketch = new KllSketch({ k, seed });
  for (const v of values) sketch.add(v);
  return sketch;
}

describe("union past capacity", () => {
  test("compresses to the smaller k, in either order", () => {
    const stream = shuffled(40_000);
    const a = sketchOf(stream.slice(0, 20_000), 400, 1);
    const b = sketchOf(stream.slice(20_000), 200, 2);
    for (const union of [a.union(b), b.union(a)]) {
      expect(union.k).toBe(200);
      expect(union.retained).toBeLessThanOrEqual(3 * 200 + 8 * union.numLevels);
      expect(union.count).toBe(40_000);
      expect(union.min).toBe(0);
      expect(union.max).toBe(39_999);
      expect(worstRankError(union, ascending(40_000))).toBeLessThanOrEqual(
        union.normalizedRankError(true),
      );
    }
  });

  describe("16 shards", () => {
    const n = 160_000;
    const stream = shuffled(n);
    const shards = (): KllSketch[] =>
      Array.from({ length: 16 }, (_, i) =>
        sketchOf(stream.slice(i * 10_000, (i + 1) * 10_000), 200, i + 1),
      );

    test.each(mergeShapes)(
      "merged as a %s stay within the bound",
      (_, merge) => {
        const union = merge(shards());
        expect(union.count).toBe(n);
        expect(union.min).toBe(0);
        expect(union.max).toBe(n - 1);
        expect(union.retained).toBeLessThanOrEqual(
          3 * 200 + 8 * union.numLevels,
        );
        for (const q of [0.25, 0.5, 0.75]) {
          const below = Math.min(n, Math.floor(union.quantile(q)) + 1);
          expect(Math.abs(below / n - q), `q ${String(q)}`).toBeLessThanOrEqual(
            union.normalizedRankError(),
          );
        }
        expect(worstRankError(union, ascending(n))).toBeLessThanOrEqual(
          union.normalizedRankError(true),
        );
      },
    );

    test("a merged result takes more values and further unions", () => {
      const union = balanced(shards());
      for (let v = n; v < n + 10_000; v++) union.add(v);
      const more = union.union(
        sketchOf(
          ascending(10_000).map((i) => n + 10_000 + i),
          200,
          99,
        ),
      );
      expect(more.count).toBe(n + 20_000);
      expect(more.max).toBe(n + 19_999);
      expect(worstRankError(more, ascending(n + 20_000))).toBeLessThanOrEqual(
        more.normalizedRankError(true),
      );
    });
  });
});

describe("union at the safe-integer limit", () => {
  const sketchOf = (count: number): KllSketch => {
    const sketch = new KllSketch();
    sketch.add(1, count);
    return sketch;
  };

  test("refuses a count past 2^53 - 1, which fromBytes would refuse", () => {
    expect(() => sketchOf(2 ** 52).union(sketchOf(2 ** 52))).toThrow(
      ParamError,
    );
  });

  test("reaches 2^53 - 1 exactly, in a frame that reads back", () => {
    const merged = sketchOf(2 ** 52).union(sketchOf(2 ** 52 - 1));
    expect(merged.count).toBe(Number.MAX_SAFE_INTEGER);
    expect(KllSketch.fromBytes(merged.toBytes()).equals(merged)).toBe(true);
  });
});
