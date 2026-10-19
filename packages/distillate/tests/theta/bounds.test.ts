import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { thetaLowerBound, thetaUpperBound } from "../../src/theta/bounds.js";

test("exact mode bounds are the retained count", () => {
  for (const sd of [1, 2, 3]) {
    expect(thetaLowerBound(1000, 1, sd)).toBe(1000);
    expect(thetaUpperBound(1000, 1, sd)).toBe(1000);
  }
});

test("nothing retained gives zero and the exact binomial upper bound", () => {
  expect(thetaLowerBound(0, 0.01, 2)).toBe(0);
  expect(thetaUpperBound(0, 0.01, 2)).toBeCloseTo(
    Math.log(0.02275) / Math.log(0.99),
    9,
  );
});

test("bounds bracket the estimate, never fall below what was retained, and widen with sd", () => {
  const r = 100;
  const p = 0.01;
  let lastLower = Infinity;
  let lastUpper = 0;
  for (const sd of [1, 2, 3]) {
    const lower = thetaLowerBound(r, p, sd);
    const upper = thetaUpperBound(r, p, sd);
    expect(lower).toBeGreaterThanOrEqual(r);
    expect(lower).toBeLessThan(r / p);
    expect(upper).toBeGreaterThan(r / p);
    expect(lower).toBeLessThan(lastLower);
    expect(upper).toBeGreaterThan(lastUpper);
    lastLower = lower;
    lastUpper = upper;
  }
});

test("sd must be 1, 2 or 3", () => {
  for (const sd of [0, 4, 1.5]) {
    expect(() => thetaLowerBound(10, 0.5, sd)).toThrow(ParamError);
    expect(() => thetaUpperBound(10, 0.5, sd)).toThrow(ParamError);
  }
});
