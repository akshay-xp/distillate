import { expect, test } from "vitest";

import {
  BlockedBloomFilter,
  blockedBitsPerKey,
  blockedFprAt,
  ParamError,
} from "../src/blocked/index.js";
import { BloomFilter, bloomSizing } from "../src/bloom/index.js";
import { VERSION } from "../src/index.js";

test("package entry exposes VERSION as a string", () => {
  expect(typeof VERSION).toBe("string");
});

test("distillate/bloom exposes bloomSizing as BloomFilter input", () => {
  expect(bloomSizing(1000, 0.01)).toEqual({ m: 9586, k: 7 });

  const f = new BloomFilter(bloomSizing(1000, 0.01));
  expect(f.m).toBe(9586);
  expect(f.k).toBe(7);
});

test("distillate/blocked exposes the bits-per-key solver", () => {
  const bpk = blockedBitsPerKey(0.01);
  // The instance getter rounds the solved bits up to whole 256-bit blocks.
  expect(BlockedBloomFilter.create(1000, 0.01).bitsPerKey).toBe(
    (Math.ceil((bpk * 1000) / 256) * 256) / 1000,
  );

  expect(blockedFprAt(bpk)).toBeLessThanOrEqual(0.01);

  expect(() => blockedBitsPerKey(1e-12)).toThrow(ParamError);
});
