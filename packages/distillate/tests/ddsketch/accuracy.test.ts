import { describe, expect, test } from "vitest";

import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import {
  bitwiseMapping,
  cubicMapping,
  type IndexMapping,
  linearMapping,
  logMapping,
  quadraticMapping,
} from "../../src/ddsketch/mapping.js";
import { denseStore } from "../../src/ddsketch/store.js";
import { rng } from "../helpers/frequency.js";
import {
  exactQuantiles,
  expectWithin,
  lognormalValues,
  paretoValues,
  uniformValues,
} from "../helpers/quantile.js";

// The promise: every quantile, tails included, within relativeAccuracy of the
// exact value at rank floor(q * (n - 1)). Zero tolerance beyond float slack.
// The promise is the unbounded one, so the store is dense: the default
// collapses at 4096 bins, which 0.001 outgrows, and what collapsing gives up
// is tested in ddsketch.test.ts.
const N = 100_000;
const QS = [0, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999, 1];
const ACCURACIES = [0.05, 0.01, 0.001];
const MAPPINGS: [string, (relativeAccuracy: number) => IndexMapping][] = [
  ["bitwise", bitwiseMapping],
  ["log", logMapping],
  ["linear", linearMapping],
  ["quadratic", quadraticMapping],
  ["cubic", cubicMapping],
];

function expectBound(values: readonly number[]): void {
  const exact = exactQuantiles(values, QS);
  for (const [, mapping] of MAPPINGS) {
    for (const relativeAccuracy of ACCURACIES) {
      const got = DDSketch.from(values, relativeAccuracy, {
        mapping,
        store: denseStore(),
      }).quantiles(QS);
      for (const [i, want] of exact.entries()) {
        expectWithin(got[i] ?? Number.NaN, want, relativeAccuracy);
      }
    }
  }
}

describe("every mapping keeps the bound", () => {
  test("on a uniform stream", () => {
    expectBound(uniformValues(11, N));
  });

  test("on a lognormal stream", () => {
    expectBound(lognormalValues(14, N));
  });

  test("on a Pareto stream", () => {
    expectBound(paretoValues(12, N));
  });

  test("on a mixed-sign stream", () => {
    const sign = rng(13);
    expectBound(lognormalValues(15, N).map((v) => (sign() < 0.4 ? -v : v)));
  });
});

test("weighted adds give the quantiles of the repeated values", () => {
  const values = lognormalValues(16, N / 10);
  const counts = rng(17);
  const weighted = DDSketch.create(0.01);
  const repeated = DDSketch.create(0.01);
  for (const v of values) {
    const count = 1 + Math.floor(counts() * 5);
    weighted.add(v, count);
    for (let i = 0; i < count; i++) repeated.add(v);
  }
  expect(weighted.quantiles(QS)).toEqual(repeated.quantiles(QS));
});
