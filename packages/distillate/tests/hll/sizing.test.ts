import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { hllSizing } from "../../src/hll/sizing.js";

const hllError = (p: number): number => 1.04 / Math.sqrt(2 ** p);

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
