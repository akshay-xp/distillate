import fc from "fast-check";
import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import {
  FORMAT_VERSION,
  HASH_MURMUR128,
  readFrameAt,
  SerializationError,
  TruncatedError,
  UnknownHashVariantError,
  writeHeader,
} from "../../src/core/serialize.js";
import { MinHash } from "../../src/minhash/minhash.js";

const BODY = 16;
const SLOTS = 24;

const keys = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

function sketchOf(items: readonly string[], k: number, seed = 0): MinHash {
  const sketch = new MinHash({ k, seed });
  for (const item of items) sketch.add(item);
  return sketch;
}

test("the frame follows the documented layout", () => {
  const frame = sketchOf(["a"], 8, 5).toBytes();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  expect(frame[5]).toBe(11);
  expect(frame[6]).toBe(HASH_MURMUR128);
  expect(view.getUint32(BODY, true)).toBe(5);
  expect(view.getUint16(BODY + 4, true)).toBe(8);
  expect([...frame.subarray(BODY + 6, BODY + 8)]).toEqual([0, 0]);
  expect(view.getUint32(8, true)).toBe(8 + 4 * 8);

  const slots = Array.from({ length: 8 }, (_, i) =>
    view.getUint32(SLOTS + 4 * i, true),
  );
  expect(slots.filter((s) => s !== 0xffffffff)).toHaveLength(1);
});

const examples: [string, () => MinHash][] = [
  ["filled", () => sketchOf(keys("f", 500), 128, 9)],
  ["small", () => sketchOf(["x", "y", "z"], 64)],
  ["empty", () => new MinHash()],
];

test.each(examples)("a %s sketch round-trips byte-identically", (_, make) => {
  const s = make();
  const restored = MinHash.fromBytes(s.toBytes());

  expect(restored.equals(s)).toBe(true);
  expect(restored.k).toBe(s.k);
  expect(restored.seed).toBe(s.seed);
  expect(restored.isEmpty).toBe(s.isEmpty);
  expect(restored.signature()).toEqual(s.signature());
  expect(restored.toBytes()).toEqual(s.toBytes());
});

// Recomputes the trailer so a mutation reaches the check under test instead of
// stopping at ChecksumError.
const resealed = (frame: Uint8Array): Uint8Array => {
  new DataView(frame.buffer).setUint32(
    frame.length - 4,
    crc32(frame.subarray(0, frame.length - 4)),
    true,
  );
  return frame;
};

const filled = (): MinHash => sketchOf(keys("f", 500), 128, 9);

type Mutation = (frame: Uint8Array, view: DataView) => void;

const lies: [string, Mutation, new (...args: never[]) => Error][] = [
  ["type 1", (f) => (f[5] = 1), SerializationError],
  ["hash variant 1", (f) => (f[6] = 1), UnknownHashVariantError],
  ["a params padding byte set", (f) => (f[BODY + 6] = 1), SerializationError],
  [
    "a k the body cannot hold",
    (_, v) => {
      v.setUint16(BODY + 4, 200, true);
    },
    TruncatedError,
  ],
];

test.each(lies)("fromBytes rejects %s", (_, mutate, expected) => {
  const frame = filled().toBytes();
  mutate(frame, new DataView(frame.buffer));

  expect(() => MinHash.fromBytes(resealed(frame))).toThrow(expected);
});

// A k the body agrees with but the constructor refuses would otherwise escape
// as a ParamError rather than the SerializationError every decode failure
// throws.
const emptyFrame = (k: number): Uint8Array => {
  const body = new Uint8Array(8 + 4 * k).fill(0xff, 8);
  new DataView(body.buffer).setUint16(4, k, true);
  return writeHeader(
    { version: FORMAT_VERSION, type: 11, flags: HASH_MURMUR128 },
    body,
  );
};

test.each([0, 1, 4097])(
  "fromBytes rejects a self-consistent frame with k %i",
  (k) => {
    expect(() => MinHash.fromBytes(emptyFrame(k))).toThrow(SerializationError);
  },
);

test("every truncated prefix of a frame is rejected with a typed error", () => {
  const frame = filled().toBytes();
  for (let n = 0; n < frame.length; n += 37) {
    expect(() => MinHash.fromBytes(frame.subarray(0, n))).toThrow(
      SerializationError,
    );
  }
});

// Arbitrary params and slot bytes, sealed with a valid CRC so every frame
// reaches the structure's own checks rather than stopping at the trailer. Half
// the frames hold exactly k slots and a quarter set a padding byte, or a
// random body would almost never agree with its own k and reach a sketch.
const forged = fc
  .tuple(
    fc.nat({ max: 0xffff }),
    fc.nat({ max: 48 }),
    fc.oneof(fc.constant(0), fc.constant(0), fc.constant(0), fc.nat(255)),
    fc.array(fc.nat({ max: 0xffffffff }), { maxLength: 48 }),
    fc.boolean(),
  )
  .map(([seed, k, pad, values, honest]) => {
    const slots = honest
      ? Array.from({ length: k }, (_, i) => values[i] ?? 0xffffffff)
      : values;
    const body = new Uint8Array(8 + 4 * slots.length);
    const view = new DataView(body.buffer);
    view.setUint32(0, seed, true);
    view.setUint16(4, k, true);
    body[6] = pad;
    slots.forEach((s, i) => {
      view.setUint32(8 + 4 * i, s, true);
    });
    return writeHeader(
      { version: FORMAT_VERSION, type: 11, flags: HASH_MURMUR128 },
      body,
    );
  });

test("a forged frame yields a working sketch or a typed error (fuzz)", () => {
  fc.assert(
    fc.property(forged, (frame) => {
      try {
        const s = MinHash.fromBytes(frame);
        expect(typeof s.jaccard(s)).toBe("number");
      } catch (err) {
        expect(err).toBeInstanceOf(SerializationError);
      }
    }),
    { numRuns: 500 },
  );
});

test("the forged generator reaches both a working sketch and each rejection", () => {
  const outcomes = new Set<string>();
  for (const frame of fc.sample(forged, { numRuns: 2000, seed: 42 })) {
    try {
      MinHash.fromBytes(frame);
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

test("a type 11 frame is walkable without knowing the structure", () => {
  const a = filled().toBytes();
  const b = new MinHash({ k: 8 }).toBytes();
  const buffer = new Uint8Array(a.length + b.length);
  buffer.set(a);
  buffer.set(b, a.length);

  const first = readFrameAt(buffer, 0);

  expect(first.type).toBe(11);
  expect(first.byteLength).toBe(a.length);
  expect(readFrameAt(buffer, first.byteLength).type).toBe(11);
});
