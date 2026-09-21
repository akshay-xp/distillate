import fc from "fast-check";
import { expect, test } from "vitest";

import { BloomFilter } from "../../src/bloom/bloom.js";
import { crc32 } from "../../src/core/crc32.js";
import { probes } from "../../src/core/hasher.js";
import { ParamError } from "../../src/core/params.js";
import {
  bytesEqual,
  FORMAT_VERSION,
  readHeader,
  SerializationError,
  TruncatedError,
  UnknownHashVariantError,
  writeHeader,
} from "../../src/core/serialize.js";
import {
  ScalableBloomFilter,
  type ScalableBloomOptions,
} from "../../src/scalable/scalable.js";

const range = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i)}`);

const filled = (
  keys: string[],
  n = 10,
  options: ScalableBloomOptions = {},
): ScalableBloomFilter => {
  const f = ScalableBloomFilter.create(n, 0.01, options);
  for (const key of keys) f.add(key);
  return f;
};

const examples: [string, string[], ScalableBloomOptions][] = [
  ["empty", [], {}],
  ["one stage", range("s", 5), {}],
  ["three stages", range("t", 60), { growth: 2, tightening: 0.85, seed: 3 }],
];

test.each(examples)(
  "a %s filter round-trips byte-identically",
  (_, keys, options) => {
    const f = filled(keys, 10, options);
    const bytes = f.toBytes();
    const restored = ScalableBloomFilter.fromBytes(bytes);

    expect(restored.equals(f)).toBe(true);
    expect(bytesEqual(restored.toBytes(), bytes)).toBe(true);
    for (const key of [...keys, ...range("miss", 100)]) {
      expect(restored.has(key)).toBe(f.has(key));
    }
  },
);

test("any filter round-trips byte-identically (property)", () => {
  fc.assert(
    fc.property(
      fc.array(fc.string(), { maxLength: 300 }),
      fc.integer({ min: 1, max: 20 }),
      (keys, n) => {
        const bytes = filled(keys, n).toBytes();
        expect(
          bytesEqual(ScalableBloomFilter.fromBytes(bytes).toBytes(), bytes),
        ).toBe(true);
      },
    ),
    { numRuns: 50 },
  );
});

// Reads the frame by the documented layout alone, not through fromBytes, so a
// layout that merely round-trips through its own reader cannot pass.
test("the frame follows the documented layout, with every stage 8-aligned", () => {
  const keys = range("t", 60);
  const f = filled(keys, 10, { seed: 3 });
  const frame = f.toBytes();

  const { type, flags, body } = readHeader(frame);
  expect(type).toBe(6);
  expect(flags).toBe(0);

  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  expect(view.getUint32(0, true)).toBe(10);
  const seed = view.getUint32(4, true);
  expect(seed).toBe(3);
  expect(view.getFloat64(8, true)).toBe(0.01);
  expect(view.getFloat64(16, true)).toBe(2);
  expect(view.getFloat64(24, true)).toBe(0.85);
  const stageCount = view.getUint32(32, true);
  expect(stageCount).toBe(3);
  expect(view.getUint32(36, true)).toBe(0);

  const stages: { m: number; k: number; bits: Uint8Array }[] = [];
  let at = 40 + 16 * stageCount;
  for (let i = 0; i < stageCount; i++) {
    const entry = 40 + 16 * i;
    const m = view.getUint32(entry, true);
    const k = view.getUint16(entry + 4, true);
    expect(view.getUint16(entry + 6, true)).toBe(0);
    const length = Math.ceil(m / 8);
    const padded = Math.ceil(length / 8) * 8;

    expect((16 + at) % 8).toBe(0);
    stages.push({ m, k, bits: body.subarray(at, at + length) });
    expect(Array.from(body.subarray(at + length, at + padded))).toEqual(
      new Array(padded - length).fill(0),
    );
    at += padded;
  }
  expect(at).toBe(body.length);

  for (const key of keys) {
    const held = stages.some(({ m, k, bits }) =>
      Array.from(probes(key, k, m, seed)).every(
        (i) => ((bits[i >>> 3] ?? 0) & (1 << (i & 7))) !== 0,
      ),
    );
    expect(held, key).toBe(true);
  }
});

test("the JSON envelope round-trips", () => {
  const f = filled(range("j", 60));
  const json = f.toJSON();
  expect(json.$).toBe("distillate");
  expect(json.v).toBe(FORMAT_VERSION);

  const restored = ScalableBloomFilter.fromJSON(
    JSON.parse(JSON.stringify(json)),
  );
  expect(restored.equals(f)).toBe(true);
  expect(() => ScalableBloomFilter.fromJSON({})).toThrow(SerializationError);
});

// Recomputes the trailer so a mutation reaches the check under test instead of
// stopping at ChecksumError.
const resealed = (frame: Uint8Array): Uint8Array => {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(
    frame.length - 4,
    crc32(frame.subarray(0, frame.length - 4)),
    true,
  );
  return frame;
};

// Frame offsets: the body starts at 16, the table at 16 + 40.
const BODY = 16;
const TABLE = BODY + 40;

type Mutation = (frame: Uint8Array, view: DataView) => Uint8Array;

const threeStages = (): Uint8Array => filled(range("t", 60)).toBytes();

const cases: [string, Mutation, new (...args: never[]) => Error][] = [
  [
    "a Bloom frame",
    () => BloomFilter.create(10, 0.01).toBytes(),
    SerializationError,
  ],
  ["hash variant 1", (f) => ((f[6] = 1), resealed(f)), UnknownHashVariantError],
  [
    "a body too short for the params",
    (f) => {
      const cut = f.slice(0, BODY + 20 + 4);
      new DataView(cut.buffer).setUint32(8, 20, true);
      return resealed(cut);
    },
    TruncatedError,
  ],
  [
    "a params padding byte set",
    (f) => ((f[BODY + 37] = 1), resealed(f)),
    SerializationError,
  ],
  [
    "a stage count of 0",
    (f, v) => (v.setUint32(BODY + 32, 0, true), resealed(f)),
    SerializationError,
  ],
  [
    "a stage count one too high",
    (f, v) => (
      v.setUint32(BODY + 32, v.getUint32(BODY + 32, true) + 1, true),
      resealed(f)
    ),
    // The extra entry is read from the first stage's bits, so the entry
    // checks reject it before the total length is compared.
    SerializationError,
  ],
  [
    "a stage m claiming more bytes than the body holds",
    (f, v) => (
      v.setUint32(TABLE, v.getUint32(TABLE, true) + 64, true),
      resealed(f)
    ),
    TruncatedError,
  ],
  [
    "a table padding byte set",
    (f) => ((f[TABLE + 6] = 1), resealed(f)),
    SerializationError,
  ],
  [
    "stage 0 m of 0",
    (f, v) => (v.setUint32(TABLE, 0, true), resealed(f)),
    SerializationError,
  ],
  [
    "stage 0 k of 0",
    (f, v) => (v.setUint16(TABLE + 4, 0, true), resealed(f)),
    SerializationError,
  ],
  [
    "stage 0 capacity of 0",
    (f, v) => (v.setUint32(TABLE + 8, 0, true), resealed(f)),
    SerializationError,
  ],
  [
    "stage 1 count above its capacity",
    (f, v) => (
      v.setUint32(TABLE + 16 + 12, v.getUint32(TABLE + 16 + 8, true) + 1, true),
      resealed(f)
    ),
    SerializationError,
  ],
  [
    "growth of 0.5",
    (f, v) => (v.setFloat64(BODY + 16, 0.5, true), resealed(f)),
    SerializationError,
  ],
  [
    "epsilon of 2",
    (f, v) => (v.setFloat64(BODY + 8, 2, true), resealed(f)),
    SerializationError,
  ],
];

test.each(cases)("fromBytes rejects %s", (_, mutate, expected) => {
  const frame = threeStages();
  const bad = mutate(frame, new DataView(frame.buffer));
  expect(() => ScalableBloomFilter.fromBytes(bad)).toThrow(expected);
  expect(() => ScalableBloomFilter.fromBytes(bad)).toThrow(SerializationError);
  expect(() => ScalableBloomFilter.fromBytes(bad)).not.toThrow(ParamError);
});

test("fromBytes rejects nonzero padding after a stage's bits", () => {
  const frame = threeStages();
  const view = new DataView(frame.buffer);
  const count = view.getUint32(BODY + 32, true);
  const m = view.getUint32(TABLE, true);
  const length = Math.ceil(m / 8);
  // Needs a stage 0 whose bits leave padding, or the test proves nothing.
  expect(length % 8).not.toBe(0);
  frame[TABLE + 16 * count + length] = 1;
  expect(() => ScalableBloomFilter.fromBytes(resealed(frame))).toThrow(
    SerializationError,
  );
});

test("every truncated prefix of a frame is rejected with a typed error", () => {
  const frame = threeStages();
  for (let length = 0; length < frame.length; length++) {
    expect(() =>
      ScalableBloomFilter.fromBytes(frame.subarray(0, length)),
    ).toThrow(SerializationError);
  }
});

// Valid settings and a sealed CRC, so each run reaches the table checks with
// sizes at their edges: zero, tiny, a stage's own capacity, and the maxima.
const edge = fc.constantFrom(0, 1, 7, 10, 0xffff, 0xffffffff);
const forged = fc
  .tuple(
    fc.integer({ min: 0, max: 4 }),
    fc.array(fc.tuple(edge, edge, edge, edge), { minLength: 4, maxLength: 4 }),
    fc.uint8Array({ maxLength: 2048 }),
    fc.boolean(),
  )
  .map(([stageCount, fields, noise, exact]) => {
    const table = fields.slice(0, stageCount);
    // Half the runs get a tail of exactly the declared stage sizes, so they
    // pass the length check and reach stage reading, when that size is small.
    const declared = table.reduce(
      (sum, [m]) => sum + Math.ceil(Math.ceil(m / 8) / 8) * 8,
      0,
    );
    const tail = exact && declared <= 4096 ? noise.slice(0, declared) : noise;
    const padded = new Uint8Array(
      exact && declared <= 4096 ? declared : tail.length,
    );
    padded.set(tail);
    const body = new Uint8Array(40 + 16 * stageCount + padded.length);
    const view = new DataView(body.buffer);
    view.setUint32(0, 10, true);
    view.setFloat64(8, 0.01, true);
    view.setFloat64(16, 2, true);
    view.setFloat64(24, 0.85, true);
    view.setUint32(32, stageCount, true);
    table.forEach(([m, k, capacity, count], i) => {
      const at = 40 + 16 * i;
      view.setUint32(at, m, true);
      view.setUint16(at + 4, k & 0xffff, true);
      view.setUint32(at + 8, capacity, true);
      view.setUint32(at + 12, count, true);
    });
    body.set(padded, 40 + 16 * stageCount);
    return writeHeader({ version: FORMAT_VERSION, type: 6, flags: 0 }, body);
  });

test("a forged frame yields a working filter or a typed error (fuzz)", () => {
  fc.assert(
    fc.property(forged, (frame) => {
      try {
        const f = ScalableBloomFilter.fromBytes(frame);
        expect(typeof f.has("probe")).toBe("boolean");
      } catch (err) {
        expect(err).toBeInstanceOf(SerializationError);
      }
    }),
    { numRuns: 500 },
  );
});

test("the forged generator reaches both a working filter and each rejection", () => {
  const outcomes = new Set<string>();
  for (const frame of fc.sample(forged, { numRuns: 2000, seed: 42 })) {
    try {
      ScalableBloomFilter.fromBytes(frame);
      outcomes.add("ok");
    } catch (err) {
      outcomes.add((err as Error).name);
    }
  }
  expect([...outcomes].sort()).toEqual([
    "SerializationError",
    "TruncatedError",
    "ok",
  ]);
});

test("equals is exactly byte equality of the frame (property)", () => {
  // Three kinds of pair: independent filters (mostly unequal, sometimes
  // equal under the small alphabet), a filter and its own restored copy
  // (equal), and a filter and its self-union, which keeps its bits but raises
  // its stage counts: the one way two filters differ in count alone.
  const keys = fc.array(fc.constantFrom("a", "b", "c", "d"), { maxLength: 80 });
  const seen = new Set<boolean>();
  fc.assert(
    fc.property(
      keys,
      keys,
      fc.nat({ max: 1 }),
      fc.nat({ max: 1 }),
      fc.constantFrom("independent", "restored", "self-union"),
      (ka, kb, sa, sb, pair) => {
        const a = filled(ka, 2, { seed: sa });
        const b =
          pair === "restored"
            ? ScalableBloomFilter.fromBytes(a.toBytes())
            : pair === "self-union"
              ? a.union(a)
              : filled(kb, 2, { seed: sb });
        const same = bytesEqual(a.toBytes(), b.toBytes());
        seen.add(same);
        expect(a.equals(b)).toBe(same);
      },
    ),
    { numRuns: 300 },
  );
  expect([...seen].sort()).toEqual([false, true]);
});
