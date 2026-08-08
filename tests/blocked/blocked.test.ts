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
import {
  BlockedBloomFilter,
  BlockedBloomParamMismatchError,
  fillBlock,
} from "../../src/blocked/blocked.js";
import { measureFpr, sampleStrings } from "../helpers/fpr.js";
import { fromBase64 } from "../helpers/base64.js";
import { ParamError } from "../../src/core/params.js";
import { BloomFilter } from "../../src/bloom/bloom.js";

test("constructor rejects invalid bitsPerKey, capacity, and seed", () => {
  const bad = [
    { bitsPerKey: 0, capacity: 1000 },
    { bitsPerKey: -5, capacity: 1000 },
    { bitsPerKey: Infinity, capacity: 1000 },
    { bitsPerKey: NaN, capacity: 1000 },
    { bitsPerKey: 12, capacity: 0 },
    { bitsPerKey: 12, capacity: -5 },
    { bitsPerKey: 12, capacity: 1.5 },
    { bitsPerKey: 12, capacity: 1000, seed: -1 },
    { bitsPerKey: 12, capacity: 1000, seed: 2 ** 32 },
  ];
  for (const params of bad) {
    expect(() => new BlockedBloomFilter(params)).toThrow(ParamError);
  }
  // bitsPerKey is a density, not a count: a fractional value is valid, and
  // union reconstructs from exactly such a value (numBlocks * 256 / capacity).
  expect(
    () => new BlockedBloomFilter({ bitsPerKey: 12.032, capacity: 1000 }),
  ).not.toThrow();
  const f = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  expect(f.has("x")).toBe(false);
});

test("create rejects invalid n and epsilon", () => {
  for (const n of [0, 1.5, -5]) {
    expect(() => BlockedBloomFilter.create(n, 0.01)).toThrow(ParamError);
  }
  for (const epsilon of [1, 0, -0.1, NaN]) {
    expect(() => BlockedBloomFilter.create(100, epsilon)).toThrow(ParamError);
  }
});

test("create builds for any valid epsilon (bits-per-key floored to 1)", () => {
  const f = BlockedBloomFilter.create(1000, 0.5);
  f.add("alice");
  expect(f.has("alice")).toBe(true);
});

test("no false negatives for any valid create params (property)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 5000 }),
      fc.double({ min: 0.001, max: 0.5, noNaN: true }),
      fc.uniqueArray(fc.string()),
      (n, epsilon, keys) => {
        const f = BlockedBloomFilter.create(n, epsilon);
        for (const key of keys) f.add(key);
        for (const key of keys) expect(f.has(key)).toBe(true);
      },
    ),
  );
});

test("ParamError is exported from the blocked subpath", async () => {
  const mod = await import("../../src/blocked/index.js");
  expect(mod.ParamError).toBeDefined();
  expect(
    () => new BlockedBloomFilter({ bitsPerKey: 0, capacity: 1000 }),
  ).toThrow(mod.ParamError);
});

const disjoint = (present: readonly string[], absent: string[]): string[] => {
  const seen = new Set(present);
  return absent.filter((k) => !seen.has(k));
};

const popcount = (x: number): number => {
  let n = x >>> 0;
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
};

test("fillBlock confines a key to one block with 8 single-bit lanes", () => {
  const numBlocks = 1024;
  fc.assert(
    fc.property(fc.string(), (key) => {
      const words = new Uint32Array(8);
      const bits = new Uint32Array(8);
      fillBlock(key, numBlocks, 0, words, bits);

      expect((words[0] ?? -1) % 8).toBe(0);
      expect((words[0] ?? -1) / 8).toBeLessThan(numBlocks);
      for (let i = 0; i < 8; i++) {
        expect(words[i]).toBe((words[0] ?? 0) + i);
        expect(popcount(bits[i] ?? 0)).toBe(1);
      }
    }),
  );
});

test("fillBlock is deterministic", () => {
  const a = { words: new Uint32Array(8), bits: new Uint32Array(8) };
  const b = { words: new Uint32Array(8), bits: new Uint32Array(8) };
  fillBlock("user:42", 777, 0, a.words, a.bits);
  fillBlock("user:42", 777, 0, b.words, b.bits);
  expect(a.words).toEqual(b.words);
  expect(a.bits).toEqual(b.bits);
});

test("fillBlock with numBlocks 1 keeps all lanes in [0, 8)", () => {
  const words = new Uint32Array(8);
  const bits = new Uint32Array(8);
  fillBlock("anything", 1, 0, words, bits);
  for (let i = 0; i < 8; i++) expect(words[i]).toBe(i);
});

test("add then has returns true across BytesLike forms", () => {
  const f = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
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
      const f = new BlockedBloomFilter({
        bitsPerKey: 12,
        capacity: 2000,
        seed: 0,
      });
      for (const key of keys) f.add(key);
      for (const key of keys) expect(f.has(key)).toBe(true);
    }),
  );
});

test("bitsPerKey reports numBlocks * 256 / capacity", () => {
  const f = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  const numBlocks = Math.ceil((12 * 1000) / 256);
  expect(f.bitsPerKey).toBe((numBlocks * 256) / 1000);
});

test("create(n, epsilon) sizes so observed FPR stays at or below epsilon", () => {
  const present = sampleStrings(1, 5000);
  for (const [epsilon, count] of [
    [1e-2, 20000],
    [1e-3, 60000],
    [1e-4, 200000],
  ] as const) {
    const absent = disjoint(present, sampleStrings(2, count));
    const f = BlockedBloomFilter.create(5000, epsilon);
    const obs = measureFpr(f, present, absent);
    expect(obs).toBeLessThanOrEqual(epsilon * 1.3);
  }
});

test("create picks bits-per-key monotonically with tighter epsilon", () => {
  const loose = BlockedBloomFilter.create(100000, 0.01).bitsPerKey;
  const tight = BlockedBloomFilter.create(100000, 0.0001).bitsPerKey;
  expect(tight).toBeGreaterThan(loose);
});

test("union merges two filters without mutating inputs", () => {
  const a = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  const b = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  a.add("x");
  b.add("y");

  const u = a.union(b);
  expect(u.has("x")).toBe(true);
  expect(u.has("y")).toBe(true);
  expect(u).not.toBe(a);
  expect(a.has("y")).toBe(false);
  expect(b.has("x")).toBe(false);
});

test("union has every key from either input (property)", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.string()),
      fc.uniqueArray(fc.string()),
      (ka, kb) => {
        const a = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 2000 });
        const b = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 2000 });
        for (const key of ka) a.add(key);
        for (const key of kb) b.add(key);
        const u = a.union(b);
        for (const key of [...ka, ...kb]) expect(u.has(key)).toBe(true);
      },
    ),
  );
});

test("union rejects mismatched params with a typed error", () => {
  const base = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });

  let caught: Error | undefined;
  try {
    base.union(new BlockedBloomFilter({ bitsPerKey: 12, capacity: 2000 }));
  } catch (e) {
    caught = e as Error;
  }
  expect(caught?.name).toBe("BlockedBloomParamMismatchError");
  expect(caught).toBeInstanceOf(BlockedBloomParamMismatchError);

  expect(() =>
    base.union(
      new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000, seed: 1 }),
    ),
  ).toThrow(/do not match/i);
});

test("toBytes emits an AMQF type-2 frame with LE params + payload", () => {
  const f = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 100, seed: 7 });
  f.add("x");
  const frame = f.toBytes();

  expect(frame[4]).toBe(3);
  expect((frame[6] ?? 0) & 0x0f).toBe(0);

  const { version, type, body } = readHeader(frame);
  expect(type).toBe(2);
  expect(version).toBe(FORMAT_VERSION);

  const numBlocks = Math.ceil((12 * 100) / 256);
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  expect(dv.getUint32(0, true)).toBe(numBlocks);
  expect(dv.getUint32(4, true)).toBe(7);
  expect(dv.getUint32(8, true)).toBe(100);
  expect(body).toHaveLength(12 + numBlocks * 32);
});

test("fromBytes round-trips params and membership", () => {
  const f = BlockedBloomFilter.create(2000, 0.01);
  const keys = sampleStrings(1, 500);
  for (const key of keys) f.add(key);

  const g = BlockedBloomFilter.fromBytes(f.toBytes());
  expect(g.toBytes()).toEqual(f.toBytes());
  for (const key of keys) expect(g.has(key)).toBe(true);
  expect(g.bitsPerKey).toBe(f.bitsPerKey);
});

test("fromBytes throws SerializationError on corrupt or foreign input", () => {
  expect(() => BlockedBloomFilter.fromBytes(new Uint8Array(3))).toThrow(
    SerializationError,
  );

  const badMagic = new BlockedBloomFilter({
    bitsPerKey: 12,
    capacity: 100,
  }).toBytes();
  badMagic[0] ^= 0xff;
  expect(() => BlockedBloomFilter.fromBytes(badMagic)).toThrow(
    SerializationError,
  );

  const badCrc = new BlockedBloomFilter({
    bitsPerKey: 12,
    capacity: 100,
  }).toBytes();
  badCrc[12] ^= 0xff;
  expect(() => BlockedBloomFilter.fromBytes(badCrc)).toThrow(
    SerializationError,
  );
});

test("length reports the number of bits currently set across lanes", () => {
  const f = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  expect(f.length).toBe(0);

  for (const key of sampleStrings(1, 200)) f.add(key);

  const { body } = readHeader(f.toBytes());
  const payload = body.subarray(12);
  let bits = 0;
  for (const byte of payload) {
    let b = byte;
    while (b) {
      b &= b - 1;
      bits++;
    }
  }

  expect(f.length).toBe(bits);
});

test("rate() estimates the current false-positive rate from actual fill", () => {
  const empty = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  expect(empty.rate()).toBe(0);
});

test("rate() equals (fill) ** 8, the split-block query width (property)", () => {
  const CAP = 1000;
  fc.assert(
    fc.property(
      fc.array(fc.string(), { minLength: 1, maxLength: 500 }),
      (keys) => {
        const f = new BlockedBloomFilter({ bitsPerKey: 12, capacity: CAP });
        for (const key of keys) f.add(key);
        const totalBits = f.bitsPerKey * CAP;
        expect(f.rate()).toBeCloseTo((f.length / totalBits) ** 8, 12);
      },
    ),
  );
});

test("fromBytes rejects a frame belonging to another structure", () => {
  const bloom = BloomFilter.create(1000, 0.01).toBytes();
  expect(() => BlockedBloomFilter.fromBytes(bloom)).toThrow(SerializationError);
});

test("fromBytes rejects a frame whose body length disagrees with declared params", () => {
  const { type, flags, body } = readHeader(
    BlockedBloomFilter.create(1000, 0.01).toBytes(),
  );
  const truncated = body.subarray(0, body.length - 4);
  const frame = writeHeader(
    { version: FORMAT_VERSION, type, flags },
    truncated,
  );
  expect(() => BlockedBloomFilter.fromBytes(frame)).toThrow(TruncatedError);

  const short = writeHeader(
    { version: FORMAT_VERSION, type, flags },
    body.subarray(0, 5),
  );
  expect(() => BlockedBloomFilter.fromBytes(short)).toThrow(TruncatedError);
});

const GOLDEN_V3 =
  "QU1RRgMCAAAFAAAAKgAAAGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAASAAAAgAAAQEAAEBAACgAAAAAEAAQAgAEAAAAiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAgAAAAAAIAAAAAAEAAAEAAAAAAQgAAAAAEAAA7NBAAA==";

const UNSUPPORTED_V2 =
  "QU1RRgICAQAFAAAAKgAAAGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAQAAIAAAAEAAAAABAAAgAAAAQAAAAAAAIAAAEAEAAQAAAAAAQEAIAAgAAQAAgEAAACAAiAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADVRVuw==";

test("reads a committed v3 golden frame (locks the format)", () => {
  const f = BlockedBloomFilter.fromBytes(fromBase64(GOLDEN_V3));
  for (const key of ["alice", "bob", "carol"]) expect(f.has(key)).toBe(true);

  const fresh = new BlockedBloomFilter({
    bitsPerKey: 12,
    capacity: 100,
    seed: 42,
  });
  for (const key of ["alice", "bob", "carol"]) fresh.add(key);
  expect(fresh.toBytes()).toEqual(fromBase64(GOLDEN_V3));
});

test("fromBytes rejects a superseded v2 frame", () => {
  expect(() =>
    BlockedBloomFilter.fromBytes(fromBase64(UNSUPPORTED_V2)),
  ).toThrow(UnknownVersionError);
});

test("fromBytes rejects a frame with an unknown hash variant", () => {
  const f = BlockedBloomFilter.create(1000, 0.01);
  const { type, body } = readHeader(f.toBytes());
  const variant1 = writeHeader(
    { version: FORMAT_VERSION, type, flags: 1 },
    body,
  );
  expect(() => BlockedBloomFilter.fromBytes(variant1)).toThrow(
    SerializationError,
  );
  expect(() => BlockedBloomFilter.fromBytes(variant1)).toThrow(/hash variant/i);
});

test("equals is true iff serialized frames match", () => {
  const keys = ["a", "b", "c"];
  const a = BlockedBloomFilter.create(1000, 0.01);
  const b = BlockedBloomFilter.create(1000, 0.01);
  for (const k of keys) {
    a.add(k);
    b.add(k);
  }

  const c = BlockedBloomFilter.create(1000, 0.01);
  for (const k of keys) c.add(k);
  c.add("x");

  const d = BlockedBloomFilter.create(1000, 0.05);
  for (const k of keys) d.add(k);

  expect(a.equals(b)).toBe(true);
  expect(a.equals(c)).toBe(false);
  expect(a.equals(d)).toBe(false);
});
