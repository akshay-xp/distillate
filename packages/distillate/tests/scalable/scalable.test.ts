import fc from "fast-check";
import { expect, test } from "vitest";

import { BloomFilter } from "../../src/bloom/bloom.js";
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

test("a full stage opens the next with grown capacity and a tightened target", () => {
  const f = ScalableBloomFilter.create(10, 0.01);
  const keys = range("g", 70);
  for (const key of keys) f.add(key);

  // Capacities 10, 20 and 40: the third stage opens at the 31st new key.
  expect(f.stages).toBe(3);
  expect(f.count).toBeLessThanOrEqual(70);
  const stages = [0, 1, 2];
  expect(f.capacity).toBe(
    stages.reduce((sum, i) => sum + Math.ceil(10 * 2 ** i), 0),
  );
  expect(f.m).toBe(
    stages.reduce(
      (sum, i) =>
        sum + bloomSizing(Math.ceil(10 * 2 ** i), 0.01 * 0.15 * 0.85 ** i).m,
      0,
    ),
  );
  for (const key of keys) expect(f.has(key)).toBe(true);
});

test("a fractional growth rounds each stage's capacity up", () => {
  const f = new ScalableBloomFilter({ n: 3, epsilon: 0.01, growth: 1.5 });
  for (const key of range("h", 4)) f.add(key);
  expect(f.stages).toBe(2);
  expect(f.capacity).toBe(3 + 5);
});

test("every added key stays present however far the chain grows (property)", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.string(), { maxLength: 3000 }),
      fc.integer({ min: 1, max: 20 }),
      fc.constantFrom(2, 4),
      fc.constantFrom(0.5, 0.85),
      (keys, n, growth, tightening) => {
        const f = new ScalableBloomFilter({
          n,
          epsilon: 0.01,
          growth,
          tightening,
        });
        for (const key of keys) f.add(key);
        for (const key of keys) expect(f.has(key)).toBe(true);
      },
    ),
    { numRuns: 50 },
  );
});

test("a stage too large to address stops growth with a RangeError", () => {
  const f = ScalableBloomFilter.create(1, 0.5, { growth: 1e10 });
  f.add("a");

  let thrown: unknown;
  try {
    f.add("b");
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(RangeError);
  expect(thrown).not.toBeInstanceOf(ParamError);
  // A plain RangeError about the stage, not the internal BitSet's own error:
  // the frame stores m as a u32, one bit short of what BitSet would allow.
  expect((thrown as Error).name).toBe("RangeError");
  expect((thrown as Error).message).toMatch(/stage 1 .* bits/);

  expect(f.has("a")).toBe(true);
  expect(f.stages).toBe(1);
  expect(f.count).toBe(1);
});

test("rate is zero when empty and matches a Bloom filter's estimate for one stage", () => {
  const f = ScalableBloomFilter.create(100, 0.01);
  expect(f.rate()).toBe(0);

  // Same geometry and seed through variant 0's mapping: identical bits.
  const { m, k } = bloomSizing(100, 0.01 * 0.15);
  const bloom = new BloomFilter({ m, k, seed: 0 });
  for (const key of range("r", 30)) {
    f.add(key);
    bloom.add(key);
  }
  expect(f.stages).toBe(1);
  // Relative, not exact: the chain computes 1 - (1 - r), which rounds.
  expect(Math.abs(f.rate() / bloom.rate() - 1)).toBeLessThan(1e-9);
});
