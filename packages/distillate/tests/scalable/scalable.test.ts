import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { bloomSizing } from "../../src/core/sizing.js";
import {
  ScalableBloomFilter,
  type ScalableBloomParams,
} from "../../src/scalable/scalable.js";

test("a new filter has one empty stage sized for the tightened first target", () => {
  const f = ScalableBloomFilter.create(1000, 0.01);
  const { m } = bloomSizing(1000, 0.01 * 0.15);

  expect(f.stages).toBe(1);
  expect(f.count).toBe(0);
  expect(f.capacity).toBe(1000);
  expect(f.growth).toBe(2);
  expect(f.tightening).toBe(0.85);
  expect(f.seed).toBe(0);
  expect(f.epsilon).toBe(0.01);
  expect(f.m).toBe(m);
  expect(f.bitsPerKey).toBe(m / 1000);
});

test("settings passed to the constructor or create are kept", () => {
  const params = { n: 10, epsilon: 0.05, growth: 4, tightening: 0.5, seed: 7 };
  for (const f of [
    new ScalableBloomFilter(params),
    ScalableBloomFilter.create(10, 0.05, {
      growth: 4,
      tightening: 0.5,
      seed: 7,
    }),
  ]) {
    expect(f.epsilon).toBe(0.05);
    expect(f.growth).toBe(4);
    expect(f.tightening).toBe(0.5);
    expect(f.seed).toBe(7);
    expect(f.capacity).toBe(10);
  }
});

test.each<[string, Partial<ScalableBloomParams>]>([
  ["n 0", { n: 0 }],
  ["n 1.5", { n: 1.5 }],
  ["n 2^32", { n: 2 ** 32 }],
  ["epsilon 0", { epsilon: 0 }],
  ["epsilon 1", { epsilon: 1 }],
  ["epsilon NaN", { epsilon: Number.NaN }],
  ["growth 1", { growth: 1 }],
  ["growth 0.5", { growth: 0.5 }],
  ["growth Infinity", { growth: Number.POSITIVE_INFINITY }],
  ["tightening 0", { tightening: 0 }],
  ["tightening 1", { tightening: 1 }],
  ["tightening NaN", { tightening: Number.NaN }],
  ["seed -1", { seed: -1 }],
  ["seed 2^32", { seed: 2 ** 32 }],
])("%s is rejected with ParamError", (_, bad) => {
  expect(
    () => new ScalableBloomFilter({ n: 100, epsilon: 0.01, ...bad }),
  ).toThrow(ParamError);
});

test("a first stage too large to address is rejected before allocating", () => {
  expect(() => ScalableBloomFilter.create(2 ** 31, 0.01)).toThrow(ParamError);
});

const range = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i)}`);

test("added keys answer present, and re-adding them changes nothing", () => {
  const f = ScalableBloomFilter.create(100, 0.01);
  const keys = range("k", 50);
  for (const key of keys) f.add(key);
  for (const key of keys) expect(f.has(key)).toBe(true);
  expect(f.count).toBe(50);

  for (const key of keys) f.add(key);
  expect(f.count).toBe(50);
  expect(f.stages).toBe(1);
});

test("an empty filter holds nothing", () => {
  expect(ScalableBloomFilter.create(100, 0.01).has("x")).toBe(false);
});

test("a byte key and the string with the same UTF-8 bytes are one key", () => {
  const f = ScalableBloomFilter.create(100, 0.01);
  f.add(Uint8Array.of(97));
  expect(f.has("a")).toBe(true);
});
