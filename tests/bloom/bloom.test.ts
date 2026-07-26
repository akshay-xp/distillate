import fc from "fast-check";
import { expect, test } from "vitest";

import { optimal } from "../../src/core/sizing.js";
import { BloomFilter } from "../../src/bloom/bloom.js";
import { measureFpr, sampleStrings } from "../helpers/fpr.js";

test("add then has returns true across BytesLike forms", () => {
  const f = new BloomFilter({ m: 4096, k: 7 });
  f.add("alice");
  expect(f.has("alice")).toBe(true);
  f.add(Uint8Array.of(1, 2, 3));
  expect(f.has(Uint8Array.of(1, 2, 3))).toBe(true);

  f.add("AB");
  expect(f.has(Uint8Array.of(65, 66))).toBe(true);
  expect(f.has(Uint8Array.of(65, 66).buffer)).toBe(true);
});

test("no false negatives for any added key (property)", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.string()), (keys) => {
      const f = new BloomFilter({ m: 1 << 16, k: 7 });
      for (const key of keys) f.add(key);
      for (const key of keys) expect(f.has(key)).toBe(true);
    }),
  );
});

const disjoint = (present: readonly string[], absent: string[]): string[] => {
  const seen = new Set(present);
  return absent.filter((k) => !seen.has(k));
};

test("create(n, epsilon) sizes so observed FPR tracks epsilon", () => {
  const present = sampleStrings(1, 5000);
  for (const [epsilon, count] of [
    [1e-2, 20000],
    [1e-3, 60000],
  ] as const) {
    const absent = disjoint(present, sampleStrings(2, count));
    const f = BloomFilter.create(5000, epsilon);
    const obs = measureFpr(f, present, absent);
    expect(Math.abs(obs - epsilon) / epsilon).toBeLessThan(0.4);
  }
});

test("bitsPerKey reports analytic m / n", () => {
  const raw = new BloomFilter({ m: 1000, k: 7 });
  expect(raw.bitsPerKey).toBe(1000 / Math.round((1000 * Math.LN2) / 7));

  const { m } = optimal(100000, 0.01);
  expect(BloomFilter.create(100000, 0.01).bitsPerKey).toBe(m / 100000);
});
