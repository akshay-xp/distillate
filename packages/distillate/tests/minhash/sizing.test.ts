import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import {
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
