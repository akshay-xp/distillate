import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import {
  THETA_MAX_K,
  THETA_MIN_K,
  thetaSizing,
} from "../../src/theta/sizing.js";

test("thetaSizing returns the smallest power-of-two k whose error meets the target", () => {
  expect(thetaSizing(1 / 64).k).toBe(4096);
  expect(thetaSizing(0.0156).k).toBe(8192);
  expect(thetaSizing(0.5).k).toBe(THETA_MIN_K);
});

test("thetaSizing rejects an unattainable error and errors outside (0, 1)", () => {
  expect(() => thetaSizing(1e-5)).toThrow(ParamError);
  expect(() => thetaSizing(0)).toThrow(ParamError);
  expect(() => thetaSizing(1)).toThrow(ParamError);
  expect(() => thetaSizing(Number.NaN)).toThrow(ParamError);
});

test("k is bounded to [16, 2^26]", () => {
  expect(THETA_MIN_K).toBe(16);
  expect(THETA_MAX_K).toBe(2 ** 26);
});
