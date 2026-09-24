import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { topKSizing } from "../../src/topk/sizing.js";

test("topKSizing(0.01) pins exact capacity", () => {
  expect(topKSizing(0.01)).toEqual({ capacity: 256 });
});

test("topKSizing returns a power of two whose load limit meets the target", () => {
  for (const epsilon of [0.5, 0.1, 0.05, 0.01, 0.001, 0.0001]) {
    const { capacity } = topKSizing(epsilon);
    expect(Number.isInteger(Math.log2(capacity))).toBe(true);
    expect(1 / Math.floor(0.75 * capacity)).toBeLessThanOrEqual(epsilon);
  }
});

test("topKSizing rejects non-probabilities", () => {
  for (const bad of [0, 1, -0.1, Number.NaN]) {
    expect(() => topKSizing(bad)).toThrow(ParamError);
  }
});

test("topKSizing rejects an error target needing more slots than the maximum", () => {
  expect(() => topKSizing(1e-9)).toThrow(ParamError);
});
