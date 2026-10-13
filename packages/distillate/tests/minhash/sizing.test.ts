import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import {
  lshSizing,
  MINHASH_MAX_K,
  MINHASH_MIN_K,
  minHashSizing,
} from "../../src/minhash/sizing.js";

test("minHashSizing returns the smallest k whose worst-case error meets the target", () => {
  expect(minHashSizing(0.05).k).toBe(100);
  expect(minHashSizing(0.0442).k).toBe(128);
  expect(minHashSizing(0.49).k).toBe(MINHASH_MIN_K);
});

test("minHashSizing rejects an unattainable error and errors outside (0, 0.5)", () => {
  expect(() => minHashSizing(0.007)).toThrow(ParamError);
  expect(() => minHashSizing(0)).toThrow(ParamError);
  expect(() => minHashSizing(0.5)).toThrow(ParamError);
  expect(() => minHashSizing(Number.NaN)).toThrow(ParamError);
});

test("k is bounded to [2, 4096]", () => {
  expect(MINHASH_MIN_K).toBe(2);
  expect(MINHASH_MAX_K).toBe(4096);
});

test("lshSizing pins the bands and rows the weighted cost picks", () => {
  expect(lshSizing(0.5, 128)).toMatchObject({ bands: 25, rows: 5 });
  expect(lshSizing(0.9, 128)).toMatchObject({ bands: 5, rows: 25 });
});

test("lshSizing never uses more slots than k, and reports areas in (0, 1)", () => {
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (const k of [2, 64, 128]) {
      const { bands, rows, falsePositive, falseNegative } = lshSizing(t, k);
      expect(bands * rows).toBeLessThanOrEqual(k);
      expect(falsePositive).toBeGreaterThan(0);
      expect(falsePositive).toBeLessThan(1);
      expect(falseNegative).toBeGreaterThan(0);
      expect(falseNegative).toBeLessThan(1);
    }
  }
});

test("weighting false positives trades them for false negatives", () => {
  const balanced = lshSizing(0.5, 128);
  const strict = lshSizing(0.5, 128, [0.9, 0.1]);
  expect(strict.falsePositive).toBeLessThan(balanced.falsePositive);
  expect(strict.falseNegative).toBeGreaterThan(balanced.falseNegative);
});

test.each<[string, () => unknown]>([
  ["threshold 0", () => lshSizing(0, 128)],
  ["threshold 1", () => lshSizing(1, 128)],
  ["threshold NaN", () => lshSizing(Number.NaN, 128)],
  ["a negative weight", () => lshSizing(0.5, 128, [-0.1, 1.1])],
  ["weights not summing to 1", () => lshSizing(0.5, 128, [0.5, 0.6])],
  ["k 1", () => lshSizing(0.5, 1)],
  ["k 4097", () => lshSizing(0.5, 4097)],
])("lshSizing rejects %s", (_, call) => {
  expect(call).toThrow(ParamError);
});
