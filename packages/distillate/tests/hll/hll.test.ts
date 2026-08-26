import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { HyperLogLog } from "../../src/hll/hll.js";

const standardError = (p: number): number => 1.04 / Math.sqrt(2 ** p);

test("the constructor rejects a precision outside [4, 18]", () => {
  for (const p of [3, 19, 14.5, NaN, 0, -1]) {
    expect(() => new HyperLogLog({ p })).toThrow(ParamError);
  }
});

test("the constructor accepts the whole supported precision range", () => {
  for (let p = 4; p <= 18; p++) {
    expect(new HyperLogLog({ p }).p).toBe(p);
  }
});

test("seed defaults to zero and round-trips", () => {
  expect(new HyperLogLog({ p: 14 }).seed).toBe(0);
  expect(new HyperLogLog({ p: 14, seed: 7 }).seed).toBe(7);
});

test("the constructor rejects a seed outside uint32", () => {
  for (const seed of [-1, 2 ** 32, 1.5]) {
    expect(() => new HyperLogLog({ p: 14, seed })).toThrow(ParamError);
  }
});

test("standardError is the analytic 1.04 / sqrt(2 ** p)", () => {
  for (const p of [4, 10, 14, 18]) {
    expect(new HyperLogLog({ p }).standardError).toBe(standardError(p));
  }
});

test("create meets the requested relative error", () => {
  for (const e of [0.005, 0.01, 0.05, 0.1, 0.2]) {
    expect(HyperLogLog.create(e).standardError).toBeLessThanOrEqual(e);
  }
});
