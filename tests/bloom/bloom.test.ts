import fc from "fast-check";
import { expect, test } from "vitest";

import {
  FORMAT_VERSION,
  readHeader,
  SerializationError,
  TruncatedError,
  UnknownVersionError,
  writeHeader,
} from "../../src/core/serialize.js";
import { optimal } from "../../src/core/sizing.js";
import { BloomFilter } from "../../src/bloom/bloom.js";
import { BlockedBloomFilter } from "../../src/blocked/blocked.js";
import { measureFpr, sampleStrings } from "../helpers/fpr.js";
import { fromBase64 } from "../helpers/base64.js";
import { ParamError } from "../../src/core/params.js";

test("constructor rejects non-positive-integer m and k", () => {
  for (const params of [
    { m: 1000, k: 0 },
    { m: 1000, k: 2.7 },
    { m: 0, k: 7 },
    { m: -5, k: 7 },
    { m: 1.5, k: 7 },
  ]) {
    expect(() => new BloomFilter(params)).toThrow(ParamError);
  }
  expect(() => new BloomFilter({ m: 1000, k: 0 })).toThrow(RangeError);

  const f = new BloomFilter({ m: 1000, k: 7 });
  expect(f.has("x")).toBe(false);
});

test("constructor rejects out-of-range seed", () => {
  for (const seed of [-1, 2 ** 32, 1.5]) {
    expect(() => new BloomFilter({ m: 1000, k: 7, seed })).toThrow(ParamError);
  }
  expect(() => new BloomFilter({ m: 1000, k: 7, seed: 0 })).not.toThrow();
  expect(
    () => new BloomFilter({ m: 1000, k: 7, seed: 0xffffffff }),
  ).not.toThrow();
});

test("create rejects invalid n and epsilon", () => {
  for (const n of [0, 1.5, -5]) {
    expect(() => BloomFilter.create(n, 0.01)).toThrow(ParamError);
  }
  for (const epsilon of [1, 0, -0.1, NaN]) {
    expect(() => BloomFilter.create(100, epsilon)).toThrow(ParamError);
  }
  const f = BloomFilter.create(100000, 0.01);
  f.add("alice");
  expect(f.has("alice")).toBe(true);
});

test("ParamError is exported from the bloom subpath", async () => {
  const mod = await import("../../src/bloom/index.js");
  expect(mod.ParamError).toBeDefined();
  expect(() => new BloomFilter({ m: 1000, k: 0 })).toThrow(mod.ParamError);
});

test("no false negatives for any valid create params (property)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 5000 }),
      fc.double({ min: 0.001, max: 0.5, noNaN: true }),
      fc.uniqueArray(fc.string()),
      (n, epsilon, keys) => {
        const f = BloomFilter.create(n, epsilon);
        for (const key of keys) f.add(key);
        for (const key of keys) expect(f.has(key)).toBe(true);
      },
    ),
  );
});

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

  expect(frame[4]).toBe(3);
  expect((frame[6] ?? 0) & 0x0f).toBe(0);

  const { version, type, body } = readHeader(frame);
  expect(type).toBe(1);
  expect(version).toBe(FORMAT_VERSION);

  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  expect(dv.getUint32(0, true)).toBe(64);
  expect(dv.getUint16(4, true)).toBe(3);
  expect(dv.getUint32(6, true)).toBe(7);
  expect(body).toHaveLength(14 + Math.ceil(64 / 8));
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

test("m, k, seed accessors report the params the filter was built with", () => {
  const f = new BloomFilter({ m: 1000, k: 7, seed: 42 });
  expect(f.m).toBe(1000);
  expect(f.k).toBe(7);
  expect(f.seed).toBe(42);

  expect(new BloomFilter({ m: 1000, k: 7 }).seed).toBe(0);

  const g = BloomFilter.create(100_000, 0.01);
  const p = optimal(100_000, 0.01);
  expect(g.m).toBe(p.m);
  expect(g.k).toBe(p.k);
  expect(g.seed).toBe(0);
});

test("length reports the number of bits currently set", () => {
  const f = new BloomFilter({ m: 4096, k: 7 });
  expect(f.length).toBe(0);

  for (const key of sampleStrings(1, 200)) f.add(key);

  const { body } = readHeader(f.toBytes());
  const payload = body.subarray(14);
  let bits = 0;
  for (const byte of payload) {
    let b = byte;
    while (b) {
      b &= b - 1;
      bits++;
    }
  }

  expect(f.length).toBe(bits);
  expect(f.length).toBeLessThanOrEqual(f.m);
});

test("rate() estimates the current false-positive rate from actual fill", () => {
  const empty = new BloomFilter({ m: 4096, k: 7 });
  expect(empty.rate()).toBe(0);

  const f = new BloomFilter({ m: 4096, k: 7 });
  for (const key of sampleStrings(1, 300)) f.add(key);
  expect(f.rate()).toBe((f.length / f.m) ** f.k);
});

test("rate() is non-decreasing as keys are added (property)", () => {
  fc.assert(
    fc.property(
      fc.array(fc.string(), { minLength: 1, maxLength: 400 }),
      (keys) => {
        const f = new BloomFilter({ m: 2048, k: 6 });
        let prev = f.rate();
        for (const key of keys) {
          f.add(key);
          const r = f.rate();
          expect(r).toBeGreaterThanOrEqual(prev);
          expect(r).toBe((f.length / f.m) ** f.k);
          prev = r;
        }
      },
    ),
  );
});

test("serializes k > 255 and keeps params roundtrip-stable (format v2)", () => {
  const f = new BloomFilter({ m: 4_000_000, k: 300, seed: 9 });
  const g = BloomFilter.fromBytes(f.toBytes());
  expect(g.k).toBe(300);
  expect(g.m).toBe(4_000_000);
  expect(g.seed).toBe(9);
  expect(() => f.union(g)).not.toThrow();

  const c = BloomFilter.create(100_000, 0.01);
  const r = BloomFilter.fromBytes(c.toBytes());
  expect(r.m).toBe(c.m);
  expect(r.k).toBe(c.k);
  expect(r.seed).toBe(c.seed);
  expect(r.bitsPerKey).toBe(c.bitsPerKey);
});

test("fromBytes rejects a frame belonging to another structure", () => {
  const blocked = BlockedBloomFilter.create(1000, 0.01).toBytes();
  expect(() => BloomFilter.fromBytes(blocked)).toThrow(SerializationError);
});

test("fromBytes rejects a frame whose body length disagrees with declared params", () => {
  const { type, flags, body } = readHeader(
    new BloomFilter({ m: 4096, k: 7 }).toBytes(),
  );
  const truncated = body.subarray(0, body.length - 4);
  const frame = writeHeader(
    { version: FORMAT_VERSION, type, flags },
    truncated,
  );
  expect(() => BloomFilter.fromBytes(frame)).toThrow(TruncatedError);

  const short = writeHeader(
    { version: FORMAT_VERSION, type, flags },
    body.subarray(0, 5),
  );
  expect(() => BloomFilter.fromBytes(short)).toThrow(TruncatedError);
});

const GOLDEN_V3 =
  "QU1RRgMBAAAABAAABwAqAAAAZQAAAAAAAAAAQAAAAgAAAAAAAAAQAAAAEACAAIAAAAAAAAAAAAIAAAAAAAACEAAgAAAAQAAAAAAAAAAAAAAAAAAEAAAAAAAAAACAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAEAAAAgAAAAAAAAAAAAAAAAAAAAAAIAAAEAAEAAAACACAi3eVnQ==";

const UNSUPPORTED_V2 =
  "QU1RRgIBAQAABAAABwAqAAAAZQAAAAAAAAAACAACAAAAEAAAAAQEAAAAAAAAAAAGAQAAAAAAAAAIAQAAAIAAAAAIAAAAAAAAAAAQAAgAAAAAAAAgAAAAAAAABAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAIAIAAAAAAAAAAAABAAAAAAL3+yiw==";

test("reads a committed v3 golden frame (locks the format)", () => {
  const f = BloomFilter.fromBytes(fromBase64(GOLDEN_V3));
  for (const key of ["alice", "bob", "carol"]) expect(f.has(key)).toBe(true);
  expect(f.m).toBe(1024);
  expect(f.k).toBe(7);
  expect(f.seed).toBe(42);

  const fresh = new BloomFilter({ m: 1024, k: 7, seed: 42 });
  for (const key of ["alice", "bob", "carol"]) fresh.add(key);
  expect(fresh.toBytes()).toEqual(fromBase64(GOLDEN_V3));
});

test("fromBytes rejects a superseded v2 frame", () => {
  expect(() => BloomFilter.fromBytes(fromBase64(UNSUPPORTED_V2))).toThrow(
    UnknownVersionError,
  );
});

test("fromBytes rejects a frame with an unknown hash variant", () => {
  const f = BloomFilter.create(1000, 0.01);
  const { type, body } = readHeader(f.toBytes());
  const variant1 = writeHeader(
    { version: FORMAT_VERSION, type, flags: 1 },
    body,
  );
  expect(() => BloomFilter.fromBytes(variant1)).toThrow(SerializationError);
  expect(() => BloomFilter.fromBytes(variant1)).toThrow(/hash variant/i);
});
