import fc from "fast-check";
import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { cuckooSizing } from "../../src/cuckoo/sizing.js";
import {
  CuckooFilter,
  CuckooFullError,
  type CuckooParams,
} from "../../src/cuckoo/cuckoo.js";
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

// The sizing promise: a filter built for n takes n distinct keys. Every size
// to 2000 because small tables are where 95% load alone used to fail.
test("a filter sized for n takes n keys, for every n to 2000", () => {
  for (let n = 1; n <= 2000; n++) {
    const f = CuckooFilter.create(n, 0.01);
    const keys = sampleStrings(21, n);
    for (const k of keys) f.add(k);

    expect(f.count).toBe(n);
    expect(keys.every((k) => f.has(k))).toBe(true);
  }
});

test("a filter sized for a million keys takes them all", () => {
  const n = 1_000_000;
  const f = CuckooFilter.create(n, 0.01);
  const keys = sampleStrings(22, n);
  for (const k of keys) f.add(k);

  expect(keys.every((k) => f.has(k))).toBe(true);
});

// The incumbent's bug: a failed displacement chain drops whichever resident it
// was carrying, and that key reads absent from then on. Here a full add must
// leave every answer exactly as it was.
test("an add into a full filter throws and changes nothing", () => {
  const f = CuckooFilter.create(1, 0.01); // 2 buckets, 8 slots
  const keys = sampleStrings(23, 20);
  const probes = sampleStrings(24, 10_000);
  let added = 0;
  let snapshot: boolean[] = [];
  let error: unknown;
  for (const k of keys) {
    snapshot = probes.map((p) => f.has(p));
    try {
      f.add(k);
    } catch (e) {
      error = e;
      break;
    }
    added++;
  }

  expect(error).toBeInstanceOf(CuckooFullError);
  expect(added).toBeLessThanOrEqual(8);
  expect(f.count).toBe(added);
  expect(keys.slice(0, added).every((k) => f.has(k))).toBe(true);
  expect(probes.map((p) => f.has(p))).toEqual(snapshot);
});

test("from sizes for the keys in hand and holds them all", () => {
  const keys = sampleStrings(27, 5000);
  const f = CuckooFilter.from(keys, 0.01, { seed: 3 });

  expect(f.count).toBe(5000);
  expect(f.buckets).toBe(cuckooSizing(5000, 0.01).buckets);
  expect(f.seed).toBe(3);
  expect(keys.every((k) => f.has(k))).toBe(true);
});

test("from with no keys sizes for one", () => {
  const f = CuckooFilter.from([], 0.01);

  expect(f.count).toBe(0);
  expect(f.buckets).toBe(2);
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
  // Slot positions are addressed as 32-bit bit offsets, like BloomFilter's m.
  ["m past 2^32 - 1 bits", { n: 500_000_000 }],
])("%s is rejected with ParamError", (_, bad) => {
  expect(() => new CuckooFilter({ n: 10, epsilon: 0.01, ...bad })).toThrow(
    ParamError,
  );
});
