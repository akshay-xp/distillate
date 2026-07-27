import fc from "fast-check";
import { expect, test } from "vitest";

import {
  BinaryFuse8,
  BinaryFuse16,
  BinaryFuseBuildError,
  buildFingerprints,
  computeParams,
} from "../../src/fuse/fuse.js";
import { readHeader, FORMAT_VERSION } from "../../src/core/serialize.js";
import { sampleStrings } from "../helpers/fpr.js";

const disjoint = (present: readonly string[], absent: string[]): string[] => {
  const seen = new Set(present);
  return absent.filter((k) => !seen.has(k));
};

test("no false negatives for any built key (property)", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.string(), { minLength: 2 }), (keys) => {
      const f = BinaryFuse8.from(keys);
      for (const key of keys) expect(f.has(key)).toBe(true);
    }),
  );
});

test("no false negatives at 10k keys", () => {
  const keys = sampleStrings(1, 10000);
  const f = BinaryFuse8.from(keys);
  for (const key of keys) expect(f.has(key)).toBe(true);
});

test("duplicate keys in the input are tolerated", () => {
  const base = sampleStrings(1, 500);
  const withDupes = [...base, ...base, ...base];
  const f = BinaryFuse8.from(withDupes);
  for (const key of base) expect(f.has(key)).toBe(true);
});

test("empty filter reports non-membership for every key", () => {
  const f = BinaryFuse8.from([]);
  for (const key of sampleStrings(2, 5000)) expect(f.has(key)).toBe(false);
});

test("single-key input finds its member", () => {
  const f = BinaryFuse8.from(["only"]);
  expect(f.has("only")).toBe(true);
});

test("size and bitsPerKey report deduped count and per-key cost", () => {
  const f = BinaryFuse8.from(sampleStrings(1, 100000));
  expect(f.size).toBe(100000);
  expect(f.bitsPerKey).toBeGreaterThanOrEqual(9);
  expect(f.bitsPerKey).toBeLessThan(10);

  const empty = BinaryFuse8.from([]);
  expect(empty.size).toBe(0);
  expect(empty.bitsPerKey).toBe(0);
});

test("fuse16 has no false negatives (property)", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.string(), { minLength: 2 }), (keys) => {
      const f = BinaryFuse16.from(keys);
      for (const key of keys) expect(f.has(key)).toBe(true);
    }),
  );
});

test("fuse16 has no false negatives at 10k keys", () => {
  const keys = sampleStrings(1, 10000);
  const f = BinaryFuse16.from(keys);
  for (const key of keys) expect(f.has(key)).toBe(true);
});

test("fuse16 false-positive rate stays at or below 1e-4 at n=100k", () => {
  const present = sampleStrings(1, 100000);
  const absent = disjoint(present, sampleStrings(2, 100000));
  const f = BinaryFuse16.from(present);
  let hits = 0;
  for (const key of absent) if (f.has(key)) hits++;
  expect(hits / absent.length).toBeLessThanOrEqual(1e-4);
});

test("fuse16 handles empty and single-key inputs", () => {
  expect(BinaryFuse16.from([]).has("anything")).toBe(false);
  expect(BinaryFuse16.from(["only"]).has("only")).toBe(true);
});

test("fuse16 reports size and ~18-19 bits per key", () => {
  const f = BinaryFuse16.from(sampleStrings(1, 100000));
  expect(f.size).toBe(100000);
  expect(f.bitsPerKey).toBeGreaterThanOrEqual(18);
  expect(f.bitsPerKey).toBeLessThan(20);
});

test("toBytes emits an AMQF type-3 frame for fuse8 and type-4 for fuse16", () => {
  const f8 = BinaryFuse8.from(sampleStrings(1, 500));
  const h8 = readHeader(f8.toBytes());
  expect(h8.type).toBe(3);
  expect(h8.version).toBe(FORMAT_VERSION);
  expect(h8.body.length).toBeGreaterThan(16);

  const f16 = BinaryFuse16.from(sampleStrings(1, 500));
  expect(readHeader(f16.toBytes()).type).toBe(4);
});

test("exhausted construction attempts throw BinaryFuseBuildError", () => {
  const params = computeParams(2);
  const hashes = Uint32Array.of(1, 2, 3, 4);
  const fp = new Uint8Array(params.arrayLength);

  let caught: Error | undefined;
  try {
    buildFingerprints(fp, hashes, params, 0);
  } catch (e) {
    caught = e as Error;
  }
  expect(caught?.name).toBe("BinaryFuseBuildError");
  expect(caught).toBeInstanceOf(BinaryFuseBuildError);
});

test("false-positive rate stays at or below 0.6% at n=100k", () => {
  const present = sampleStrings(1, 100000);
  const absent = disjoint(present, sampleStrings(2, 100000));
  const f = BinaryFuse8.from(present);
  let hits = 0;
  for (const key of absent) if (f.has(key)) hits++;
  expect(hits / absent.length).toBeLessThanOrEqual(0.006);
});
