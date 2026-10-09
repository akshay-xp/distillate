import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import {
  collapsingHighestStore,
  collapsingLowestStore,
  denseStore,
  sparseStore,
} from "../../src/ddsketch/store.js";
import { lognormalValues } from "../helpers/quantile.js";

// quantile at every rank: equal answers at every rank means the same counts
// in the same bins, which is what an exact union promises.
function everyRank(sketch: DDSketch): number[] {
  const n = sketch.count;
  if (n <= 1) return [sketch.quantile(0)];
  return Array.from({ length: n }, (_, r) => sketch.quantile(r / (n - 1)));
}

const stream = fc.array(
  fc.oneof(fc.constant(0), fc.double({ min: -1e12, max: 1e12, noNaN: true })),
  { minLength: 1, maxLength: 200 },
);

describe.each([
  denseStore(),
  sparseStore(),
  collapsingLowestStore(8),
  collapsingHighestStore(8),
])("over a $kind store", (store) => {
  test("folding the parts in any order is one sketch over the stream", () => {
    fc.assert(
      fc.property(
        stream.chain((values) =>
          fc.tuple(
            fc.constant(values),
            fc.array(fc.integer({ min: 0, max: 4 }), {
              minLength: values.length,
              maxLength: values.length,
            }),
            fc.array(fc.double({ noNaN: true }), {
              minLength: 5,
              maxLength: 5,
            }),
          ),
        ),
        ([values, part, order]) => {
          const parts: number[][] = [[], [], [], [], []];
          values.forEach((v, i) => parts[part[i] ?? 0]?.push(v));
          const folded = parts
            .map((p, i) => ({ p, key: order[i] ?? 0 }))
            .sort((a, b) => a.key - b.key)
            .map(({ p }) => DDSketch.from(p, 0.01, { store }))
            .reduce((a, b) => a.union(b));
          const whole = DDSketch.from(values, 0.01, { store });

          expect(folded.count).toBe(whole.count);
          expect(folded.min).toBe(whole.min);
          expect(folded.max).toBe(whole.max);
          const scale = values.reduce((s, v) => s + Math.abs(v), 0);
          expect(Math.abs(folded.sum - whole.sum)).toBeLessThanOrEqual(
            1e-12 * scale,
          );
          expect(everyRank(folded)).toEqual(everyRank(whole));
        },
      ),
    );
  });
});

test("a union leaves both operands as they were", () => {
  const a = DDSketch.from(lognormalValues(31, 300), 0.01);
  const b = DDSketch.from(lognormalValues(32, 300), 0.01);
  const before = [everyRank(a), a.count, a.sum, everyRank(b), b.count, b.sum];
  a.union(b);
  expect([everyRank(a), a.count, a.sum, everyRank(b), b.count, b.sum]).toEqual(
    before,
  );
});

test("an empty side contributes nothing", () => {
  const empty = DDSketch.create(0.01);
  const both = empty.union(DDSketch.create(0.01));
  expect(both.count).toBe(0);
  expect(both.min).toBeNaN();
  expect(both.max).toBeNaN();

  const a = DDSketch.from(lognormalValues(33, 100), 0.01);
  const withEmpty = a.union(empty);
  expect([
    withEmpty.count,
    withEmpty.sum,
    withEmpty.min,
    withEmpty.max,
  ]).toEqual([a.count, a.sum, a.min, a.max]);
  expect(everyRank(withEmpty)).toEqual(everyRank(a));
});

test("the receiver's store holds the union", () => {
  const dense = DDSketch.from([1, 2], 0.01, { store: denseStore() });
  const sparse = DDSketch.from([3], 0.01, { store: sparseStore() });
  expect(dense.union(sparse).store.kind).toBe("dense");
});
