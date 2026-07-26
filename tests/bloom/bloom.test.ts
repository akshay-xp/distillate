import fc from "fast-check";
import { expect, test } from "vitest";

import { readHeader, SerializationError } from "../../src/core/serialize.js";
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

test("toBytes emits an AMQF type-1 frame with LE params + payload", () => {
  const f = new BloomFilter({ m: 64, k: 3, seed: 7 });
  f.add("x");
  const frame = f.toBytes();

  const { version, type, body } = readHeader(frame);
  expect(type).toBe(1);
  expect(version).toBe(1);

  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  expect(dv.getUint32(0, true)).toBe(64);
  expect(body[4]).toBe(3);
  expect(dv.getUint32(5, true)).toBe(7);
  expect(body).toHaveLength(9 + Math.ceil(64 / 8));
});

test("fromBytes round-trips params and membership (property)", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.string()), (keys) => {
      const f = new BloomFilter({ m: 1 << 12, k: 7 });
      for (const key of keys) f.add(key);
      const g = BloomFilter.fromBytes(f.toBytes());
      for (const key of keys) expect(g.has(key)).toBe(true);
      expect(g.toBytes()).toEqual(f.toBytes());
    }),
  );
});

test("fromBytes preserves membership answers for absent keys", () => {
  const f = new BloomFilter({ m: 1 << 12, k: 7, seed: 3 });
  for (const key of sampleStrings(1, 200)) f.add(key);
  const g = BloomFilter.fromBytes(f.toBytes());
  for (const key of sampleStrings(2, 50)) expect(g.has(key)).toBe(f.has(key));
});

test("fromBytes throws SerializationError on corrupt or foreign input", () => {
  expect(() => BloomFilter.fromBytes(new Uint8Array(3))).toThrow(
    SerializationError,
  );

  const badMagic = new BloomFilter({ m: 64, k: 3 }).toBytes();
  badMagic[0] ^= 0xff;
  expect(() => BloomFilter.fromBytes(badMagic)).toThrow(SerializationError);

  const badCrc = new BloomFilter({ m: 64, k: 3 }).toBytes();
  badCrc[9] ^= 0xff;
  expect(() => BloomFilter.fromBytes(badCrc)).toThrow(SerializationError);
});

test("union merges two filters without mutating inputs", () => {
  const a = new BloomFilter({ m: 1 << 12, k: 7 });
  const b = new BloomFilter({ m: 1 << 12, k: 7 });
  a.add("x");
  b.add("y");
  const snapA = a.toBytes();
  const snapB = b.toBytes();

  const u = a.union(b);
  expect(u.has("x")).toBe(true);
  expect(u.has("y")).toBe(true);
  expect(u).not.toBe(a);
  expect(a.toBytes()).toEqual(snapA);
  expect(b.toBytes()).toEqual(snapB);
});

test("union has every key from either input (property)", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.string()),
      fc.uniqueArray(fc.string()),
      (ka, kb) => {
        const a = new BloomFilter({ m: 1 << 13, k: 7 });
        const b = new BloomFilter({ m: 1 << 13, k: 7 });
        for (const key of ka) a.add(key);
        for (const key of kb) b.add(key);
        const u = a.union(b);
        for (const key of [...ka, ...kb]) expect(u.has(key)).toBe(true);
      },
    ),
  );
});

test("union rejects mismatched params with a typed error", () => {
  const base = new BloomFilter({ m: 64, k: 7, seed: 0 });

  let caught: Error | undefined;
  try {
    base.union(new BloomFilter({ m: 128, k: 7, seed: 0 }));
  } catch (e) {
    caught = e as Error;
  }
  expect(caught?.name).toBe("BloomParamMismatchError");

  expect(() => base.union(new BloomFilter({ m: 64, k: 5, seed: 0 }))).toThrow(
    /do not match/i,
  );
  expect(() => base.union(new BloomFilter({ m: 64, k: 7, seed: 1 }))).toThrow(
    /do not match/i,
  );
});
