import { expect, test } from "vitest";

import {
  classicBloomRows,
  comparisonRows,
  distillateOnlyRows,
  FUSE8_FPR,
} from "../src/compare.js";

test("classicBloomRows builds a matched head-to-head at each capacity", () => {
  const rows = classicBloomRows([100000]);
  expect(rows.map((r) => r.name)).toEqual([
    "distillate/bloom",
    "bloom-filters",
    "bloomfilter",
  ]);
  for (const r of rows) {
    expect(r.n).toBe(100000);
    expect(r.standalone).toBe(false);
    expect(r.bitsPerKey).toBeGreaterThan(9);
    expect(r.bitsPerKey).toBeLessThan(10);
    expect(r.measuredFpr).toBeGreaterThan(0);
    expect(r.measuredFpr).toBeLessThanOrEqual(1.25 * 0.01);
  }
});

test("distillateOnlyRows reports the standalone structures", () => {
  const rows = distillateOnlyRows([100000]);
  expect(rows.map((r) => r.name)).toEqual(["blocked", "fuse8", "fuse16"]);
  for (const r of rows) {
    expect(r.standalone).toBe(true);
    expect(r.bitsPerKey).toBeGreaterThan(0);
  }
  const by = (name: string) => {
    const r = rows.find((x) => x.name === name);
    if (!r) throw new Error(`no row for ${name}`);
    return r;
  };
  const blocked = by("blocked");
  expect(blocked.measuredFpr).toBeGreaterThan(0);
  expect(blocked.measuredFpr).toBeLessThanOrEqual(1.3 * 0.01);
  const fuse8 = by("fuse8");
  expect(fuse8.measuredFpr).toBeGreaterThan(0);
  expect(fuse8.measuredFpr).toBeLessThanOrEqual(1.25 * FUSE8_FPR);
  const fuse16 = by("fuse16");
  expect(fuse16.measuredFpr).toBeGreaterThan(0);
  expect(fuse16.measuredFpr).toBeLessThan(FUSE8_FPR);
  expect(fuse16.bitsPerKey).toBe(2 * fuse8.bitsPerKey);
});

test("comparisonRows assembles classic + standalone across capacities", () => {
  const rows = comparisonRows([10000, 100000]);
  expect(rows).toHaveLength(12);
  expect(rows.slice(0, 6).map((r) => r.name)).toEqual([
    "distillate/bloom",
    "bloom-filters",
    "bloomfilter",
    "blocked",
    "fuse8",
    "fuse16",
  ]);
  for (const r of rows) {
    const isClassic = !r.standalone;
    expect(isClassic).toBe(
      ["distillate/bloom", "bloom-filters", "bloomfilter"].includes(r.name),
    );
    if (isClassic) {
      expect(r.measuredFpr).toBeLessThanOrEqual(1.25 * r.targetFpr);
    }
  }
});
