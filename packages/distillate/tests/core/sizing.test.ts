import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { bloomSizing, countMinSizing } from "../../src/core/sizing.js";

const analyticFpr = (n: number, m: number, k: number): number =>
  (1 - Math.exp((-k * n) / m)) ** k;

test("bloomSizing returns near-optimal sizing within 5% of target FPR", () => {
  for (const n of [1e3, 1e6]) {
    for (const epsilon of [1e-2, 1e-4]) {
      const { m, k } = bloomSizing(n, epsilon);
      expect(Number.isInteger(m)).toBe(true);
      expect(Number.isInteger(k)).toBe(true);
      expect(m).toBeGreaterThan(0);
      expect(k).toBeGreaterThanOrEqual(1);
      expect(Math.abs(analyticFpr(n, m, k) - epsilon) / epsilon).toBeLessThan(
        0.05,
      );
    }
  }
});

test("bloomSizing(1000, 0.01) pins exact m and k", () => {
  expect(bloomSizing(1000, 0.01)).toEqual({ m: 9586, k: 7 });
});

test("countMinSizing(0.001, 0.001) pins exact width and depth", () => {
  expect(countMinSizing(0.001, 0.001)).toEqual({ width: 2719, depth: 7 });
});

test("countMinSizing solves width from epsilon and depth from delta", () => {
  for (const epsilon of [0.1, 0.01, 0.001, 0.0001]) {
    for (const delta of [0.1, 0.01, 0.001]) {
      const { width, depth } = countMinSizing(epsilon, delta);
      expect(width).toBe(Math.ceil(Math.E / epsilon));
      expect(depth).toBe(Math.ceil(Math.log(1 / delta)));
    }
  }
});

test("countMinSizing rejects non-probabilities", () => {
  for (const bad of [0, 1, Number.NaN]) {
    expect(() => countMinSizing(bad, 0.01)).toThrow(ParamError);
    expect(() => countMinSizing(0.01, bad)).toThrow(ParamError);
  }
});
