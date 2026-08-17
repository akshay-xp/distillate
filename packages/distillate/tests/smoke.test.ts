import { expect, test } from "vitest";

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
