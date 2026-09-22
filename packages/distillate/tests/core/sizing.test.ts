import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { bloomSizing, hllSizing } from "../../src/core/sizing.js";

const hllError = (p: number): number => 1.04 / Math.sqrt(2 ** p);

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

test("hllSizing(0.01) pins precision 14", () => {
  expect(hllSizing(0.01).p).toBe(14);
});

test("hllSizing returns the smallest precision that meets the target", () => {
  for (const e of [0.005, 0.01, 0.05, 0.1, 0.2]) {
    const { p } = hllSizing(e);
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(4);
    expect(p).toBeLessThanOrEqual(18);
    expect(hllError(p)).toBeLessThanOrEqual(e);
    if (p > 4) expect(hllError(p - 1)).toBeGreaterThan(e);
  }
});

test("hllSizing rejects an unattainable error and non-probabilities", () => {
  expect(() => hllSizing(0.001)).toThrow(ParamError);
  expect(() => hllSizing(0)).toThrow(ParamError);
  expect(() => hllSizing(1)).toThrow(ParamError);
});
