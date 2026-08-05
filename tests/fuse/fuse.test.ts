import fc from "fast-check";
import { expect, test } from "vitest";

import {
  BinaryFuse8,
  BinaryFuse16,
  BinaryFuseBuildError,
  buildFingerprints,
  computeParams,
} from "../../src/fuse/fuse.js";
import {
  readHeader,
  FORMAT_VERSION,
  SerializationError,
  TruncatedError,
  writeHeader,
} from "../../src/core/serialize.js";
import { sampleStrings } from "../helpers/fpr.js";

test("from([]) is a well-defined empty filter, stable across serialization", () => {
  const f8 = BinaryFuse8.from([]);
  const g8 = BinaryFuse8.fromBytes(f8.toBytes());
  const f16 = BinaryFuse16.from([]);
  const g16 = BinaryFuse16.fromBytes(f16.toBytes());
  for (const f of [f8, g8, f16, g16]) {
    expect(f.size).toBe(0);
    for (const key of ["a", "alice", "", "xyz"]) {
      expect(f.has(key)).toBe(false);
    }
  }
});

test("from with keys is unaffected by the empty-set guard", () => {
  const f = BinaryFuse8.from(["alice", "bob"]);
  expect(f.size).toBe(2);
  expect(f.has("alice")).toBe(true);
  expect(f.has("bob")).toBe(true);
});

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

test.each([
  ["fuse8", BinaryFuse8],
  ["fuse16", BinaryFuse16],
] as const)("fromBytes round-trips %s", (_name, Variant) => {
  const present = sampleStrings(1, 500);
  const f = Variant.from(present);
  const g = Variant.fromBytes(f.toBytes());

  expect(g.toBytes()).toEqual(f.toBytes());
  for (const key of present) expect(g.has(key)).toBe(true);
  for (const key of sampleStrings(2, 200)) expect(g.has(key)).toBe(f.has(key));
  expect(g.size).toBe(f.size);
  expect(g.bitsPerKey).toBe(f.bitsPerKey);
});

test("fromBytes rejects truncated, bad-magic, and corrupt-CRC frames", () => {
  expect(() => BinaryFuse8.fromBytes(new Uint8Array(3))).toThrow(
    SerializationError,
  );

  const badMagic = BinaryFuse8.from(sampleStrings(1, 100)).toBytes();
  badMagic[0] ^= 0xff;
  expect(() => BinaryFuse8.fromBytes(badMagic)).toThrow(SerializationError);

  const badCrc = BinaryFuse8.from(sampleStrings(1, 100)).toBytes();
  badCrc[12] ^= 0xff;
  expect(() => BinaryFuse8.fromBytes(badCrc)).toThrow(SerializationError);
});

test("fromBytes rejects a frame of the wrong fuse type", () => {
  const frame16 = BinaryFuse16.from(sampleStrings(1, 100)).toBytes();
  expect(() => BinaryFuse8.fromBytes(frame16)).toThrow(SerializationError);

  const frame8 = BinaryFuse8.from(sampleStrings(1, 100)).toBytes();
  expect(() => BinaryFuse16.fromBytes(frame8)).toThrow(SerializationError);
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

test("fromBytes rejects a frame whose body length disagrees with declared params", () => {
  const { type, body } = readHeader(
    BinaryFuse8.from(sampleStrings(1, 500)).toBytes(),
  );
  const truncated = body.subarray(0, body.length - 4);
  const frame = writeHeader(
    { version: FORMAT_VERSION, type, flags: 0 },
    truncated,
  );
  expect(() => BinaryFuse8.fromBytes(frame)).toThrow(TruncatedError);

  const short = writeHeader(
    { version: FORMAT_VERSION, type, flags: 0 },
    body.subarray(0, 5),
  );
  expect(() => BinaryFuse8.fromBytes(short)).toThrow(TruncatedError);
});
