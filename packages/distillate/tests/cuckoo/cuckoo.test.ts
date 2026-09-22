import fc from "fast-check";
import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { CuckooFilter, type CuckooParams } from "../../src/cuckoo/cuckoo.js";
import { sampleStrings } from "../helpers/fpr.js";

test("a new filter is empty and carries its sizing geometry", () => {
  const f = CuckooFilter.create(1000, 0.01);

  expect(f.count).toBe(0);
  expect(f.buckets).toBe(296);
  expect(f.capacity).toBe(1184);
  expect(f.fingerprintBits).toBe(10);
  expect(f.m).toBe(11840);
  expect(f.bitsPerKey).toBe(11.84);
  expect(f.seed).toBe(0);
  expect(f.epsilon).toBe(0.01);
});

test("a seed passed to the constructor or create is kept", () => {
  for (const f of [
    new CuckooFilter({ n: 10, epsilon: 0.01, seed: 7 }),
    CuckooFilter.create(10, 0.01, { seed: 7 }),
  ]) {
    expect(f.seed).toBe(7);
  }
});

test("every added key is found", () => {
  fc.assert(
    fc.property(fc.array(fc.string(), { maxLength: 200 }), (keys) => {
      const f = CuckooFilter.create(1000, 0.01);
      for (const k of keys) f.add(k);
      return keys.every((k) => f.has(k));
    }),
  );
});

// Multiset semantics: a repeat is stored again, so a later delete of one
// copy cannot remove the only fingerprint another add is relying on.
test("every add takes a slot, including a repeat", () => {
  const f = CuckooFilter.create(1000, 0.01);
  f.add("a");
  f.add("a");
  f.add("a");

  expect(f.count).toBe(3);
});

test("an empty filter holds nothing", () => {
  expect(CuckooFilter.create(1000, 0.01).has("a")).toBe(false);
});

// The 10-bit slots above straddle words; 32 is the width where a `1 << f`
// mask wraps to 1 in JS, so it needs its own check.
test("fingerprints as wide as 32 bits are stored and found", () => {
  const f = CuckooFilter.create(1000, 2e-9);
  const keys = sampleStrings(20, 100);
  for (const k of keys) f.add(k);

  expect(f.fingerprintBits).toBe(32);
  expect(keys.every((k) => f.has(k))).toBe(true);
});

test.each<[string, Partial<CuckooParams>]>([
  ["n 0", { n: 0 }],
  ["n 1.5", { n: 1.5 }],
  ["n 2^32", { n: 2 ** 32 }],
  ["epsilon 0", { epsilon: 0 }],
  ["epsilon 1", { epsilon: 1 }],
  ["epsilon NaN", { epsilon: Number.NaN }],
  ["epsilon 1e-9", { epsilon: 1e-9 }],
  ["seed -1", { seed: -1 }],
  ["seed 2^32", { seed: 2 ** 32 }],
])("%s is rejected with ParamError", (_, bad) => {
  expect(() => new CuckooFilter({ n: 10, epsilon: 0.01, ...bad })).toThrow(
    ParamError,
  );
});
