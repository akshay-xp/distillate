import { expect, test } from "vitest";

import {
  adapters,
  bloomfilterAdapter,
  bloomFiltersAdapter,
  distillateBloomAdapter,
  optimalMK,
} from "../src/adapters.js";
import { hitMissPools } from "../src/harness.js";

test("distillate/bloom adapter builds at the target FPR", () => {
  expect(distillateBloomAdapter.name).toBe("distillate/bloom");
  const f = distillateBloomAdapter.build(hitMissPools(1000).hit);
  expect(f.has("0:0")).toBe(true);
  expect(f.bitsPerKey).toBeGreaterThan(9);
  expect(f.bitsPerKey).toBeLessThan(10);
});

test("optimalMK computes standard m,k for (n, eps)", () => {
  expect(optimalMK(1000, 0.01)).toEqual({ m: 9586, k: 7 });
});

test("bloomfilter adapter builds at the target FPR via computed m,k", () => {
  expect(bloomfilterAdapter.name).toBe("bloomfilter");
  const f = bloomfilterAdapter.build(hitMissPools(1000).hit);
  expect(f.has("0:0")).toBe(true);
  expect(f.bitsPerKey).toBeGreaterThan(9);
  expect(f.bitsPerKey).toBeLessThan(10);
});

test("bloom-filters adapter builds at the target FPR", () => {
  expect(bloomFiltersAdapter.name).toBe("bloom-filters");
  const f = bloomFiltersAdapter.build(hitMissPools(1000).hit);
  expect(f.has("0:0")).toBe(true);
  expect(f.bitsPerKey).toBeGreaterThan(9);
  expect(f.bitsPerKey).toBeLessThan(10);
});

test("each adapter can create an empty, addable filter", () => {
  for (const a of adapters) {
    const f = a.create(1000);
    f.add("x");
    expect(f.has("x")).toBe(true);
  }
});

test("adapters are configured to matching bits/key", () => {
  expect(adapters.map((a) => a.name)).toEqual([
    "distillate/bloom",
    "bloom-filters",
    "bloomfilter",
  ]);
  const pool = hitMissPools(1000).hit;
  const bpks = adapters.map((a) => a.build(pool).bitsPerKey);
  for (const bpk of bpks) {
    expect(bpk).toBeGreaterThan(9);
    expect(bpk).toBeLessThan(10);
  }
  expect(Math.max(...bpks) - Math.min(...bpks)).toBeLessThan(0.5);
});
