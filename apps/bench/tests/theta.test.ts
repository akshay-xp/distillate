import { expect, test } from "vitest";

import {
  setCountAdapters,
  THETA_OVERLAPS,
  THETA_SEEDS,
  THETA_SET_SIZE,
  thetaRows,
} from "../src/theta.js";

test("the bench compares Theta with HLL inclusion-exclusion and an exact Set", () => {
  expect(setCountAdapters.map((a) => a.name)).toEqual([
    "distillate/theta",
    "distillate/hll",
    "Set",
  ]);
  expect(THETA_OVERLAPS).toEqual([0.01, 0.1, 0.5]);
  expect(THETA_SET_SIZE).toBe(1_000_000);
  expect(THETA_SEEDS).toBe(10);
});

test("theta rows time each library and score its estimates against the truth", () => {
  const rows = thetaRows(20_000, [0.1], 3);

  expect(rows.map((r) => r.name)).toEqual([
    "distillate/theta",
    "distillate/hll",
    "Set",
  ]);
  for (const r of rows) {
    expect(r.overlap, r.name).toBe(0.1);
    expect(r.addOpsPerSec, r.name).toBeGreaterThan(0);
    expect(r.setOpsMs, r.name).toBeGreaterThan(0);
  }
  const [theta, hll, exact] = rows;
  expect(exact?.intersectionError).toBe(0);
  expect(exact?.differenceError).toBe(0);
  expect(exact?.bytes).toBeNull();
  for (const sketch of [theta, hll]) {
    expect(Number.isFinite(sketch?.intersectionError)).toBe(true);
    expect(Number.isFinite(sketch?.differenceError)).toBe(true);
    expect(sketch?.bytes).toBeGreaterThan(0);
  }
});

test("theta is exact while the union holds fewer than k keys", () => {
  const [theta] = thetaRows(2_000, [0.1], 1);

  expect(theta?.intersectionError).toBe(0);
  expect(theta?.differenceError).toBe(0);
});
