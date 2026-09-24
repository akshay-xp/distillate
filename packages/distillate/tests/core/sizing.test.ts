import { expect, test } from "vitest";

import { bloomSizing } from "../../src/core/sizing.js";

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
