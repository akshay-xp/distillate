import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import {
  KLL_MAX_K,
  KLL_MIN_K,
  kllRankError,
  kllSizing,
} from "../../src/kll/sizing.js";

test("kllRankError gives the published 99% fits for one rank and a whole CDF", () => {
  expect(kllRankError(200, false)).toBeCloseTo(0.0133, 4);
  expect(kllRankError(200, true)).toBeCloseTo(0.0165, 4);
});

test("kllSizing returns the smallest k whose single-rank error meets the target", () => {
  expect(kllSizing(kllRankError(200, false)).k).toBe(200);
  expect(kllSizing(kllRankError(1000, false)).k).toBe(1000);
  expect(kllSizing(0.5).k).toBe(KLL_MIN_K);
});

test("kllSizing rejects an unattainable error and errors outside (0, 1)", () => {
  expect(() => kllSizing(1e-5)).toThrow(ParamError);
  for (const bad of [0, 1, Number.NaN, -0.1]) {
    expect(() => kllSizing(bad)).toThrow(ParamError);
  }
});

test("k is bounded to [8, 65535]", () => {
  expect(KLL_MIN_K).toBe(8);
  expect(KLL_MAX_K).toBe(65_535);
});
