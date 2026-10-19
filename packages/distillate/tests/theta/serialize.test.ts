import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import {
  FORMAT_VERSION,
  HASH_MURMUR128,
  SerializationError,
  TruncatedError,
  UnknownHashVariantError,
  writeHeader,
} from "../../src/core/serialize.js";
import { ThetaSketch } from "../../src/theta/theta.js";
import { allocatedBy } from "../helpers/topk.js";

const BODY = 16;
const HASHES = BODY + 24;

const keys = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

function sketchOf(items: readonly string[], k: number, seed = 0): ThetaSketch {
  const sketch = new ThetaSketch({ k, seed });
  for (const item of items) sketch.add(item);
  return sketch;
}

const u64 = (view: DataView, at: number): number =>
  view.getUint32(at + 4, true) * 2 ** 32 + view.getUint32(at, true);

test("the frame follows the documented layout", () => {
  const frame = sketchOf(["a", "b", "c"], 16, 5).toBytes();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  expect(frame[5]).toBe(13);
  expect(frame[6]).toBe(HASH_MURMUR128);
  expect(view.getUint32(8, true)).toBe(24 + 8 * 3);
  expect(view.getUint32(BODY, true)).toBe(5);
  expect(view.getUint32(BODY + 4, true)).toBe(16);
  expect(u64(view, BODY + 8)).toBe(2 ** 53);
  expect(view.getUint32(BODY + 16, true)).toBe(3);
  expect(view.getUint32(BODY + 20, true)).toBe(0);
  const hashes = [0, 1, 2].map((i) => u64(view, HASHES + 8 * i));
  expect(hashes).toEqual([...hashes].sort((x, y) => x - y));
  expect(new Set(hashes).size).toBe(3);
});

const estimating = (): ThetaSketch => sketchOf(keys("e", 20_000), 256, 9);

const examples: [string, () => ThetaSketch][] = [
  ["empty", () => new ThetaSketch()],
  ["exact", () => sketchOf(keys("x", 200), 1024)],
  ["estimating", estimating],
  [
    "intersected",
    () =>
      estimating().intersect(sketchOf(keys("e", 30_000).slice(10_000), 256, 9)),
  ],
];

test.each(examples)("a %s sketch round-trips byte-identically", (_, make) => {
  const s = make();
  const restored = ThetaSketch.fromBytes(s.toBytes());

  expect(restored.equals(s)).toBe(true);
  expect(restored.k).toBe(s.k);
  expect(restored.seed).toBe(s.seed);
  expect(restored.count()).toBe(s.count());
  expect(restored.isEstimating).toBe(s.isEstimating);
  expect(restored.toBytes()).toEqual(s.toBytes());
});

test("the same keys in another order give the same bytes", () => {
  const reversed = sketchOf(keys("e", 20_000).reverse(), 256, 9);
  expect(reversed.toBytes()).toEqual(estimating().toBytes());
});

test("a decoded sketch takes more keys", () => {
  const restored = ThetaSketch.fromBytes(
    sketchOf(keys("x", 200), 1024).toBytes(),
  );
  restored.add("x:200");
  expect(restored.count()).toBe(201);
});

test("a decoded sketch is read without allocating beyond the decode", () => {
  const bytes = sketchOf(keys("x", 100_000), 4096).toBytes();
  const decode = allocatedBy(() => ThetaSketch.fromBytes(bytes)).bytes;
  const decodeAndRead = allocatedBy(() =>
    ThetaSketch.fromBytes(bytes).count(),
  ).bytes;
  expect(decodeAndRead).toBeLessThanOrEqual(decode);
});

test("a sketch round-trips through JSON", () => {
  const s = estimating();
  const restored = ThetaSketch.fromJSON(JSON.parse(JSON.stringify(s)));
  expect(restored.equals(s)).toBe(true);
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

const setU64 = (view: DataView, at: number, value: number): void => {
  view.setUint32(at, value >>> 0, true);
  view.setUint32(at + 4, Math.floor(value / 2 ** 32), true);
};

// A k 16 frame holding 17 ascending hashes: self-consistent in length, but
// more than any canonical sample keeps.
const overfull = (): Uint8Array => {
  const body = new Uint8Array(24 + 8 * 17);
  const view = new DataView(body.buffer);
  view.setUint32(4, 16, true);
  setU64(view, 8, 2 ** 53);
  view.setUint32(16, 17, true);
  for (let i = 0; i < 17; i++) setU64(view, 24 + 8 * i, i + 1);
  return writeHeader(
    { version: FORMAT_VERSION, type: 13, flags: HASH_MURMUR128 },
    body,
  );
};

type Mutation = (frame: Uint8Array, view: DataView) => void;

const hashAt = (view: DataView, i: number): number => u64(view, HASHES + 8 * i);
const last = (view: DataView): number => view.getUint32(BODY + 16, true) - 1;

const lies: [string, Mutation, new (...args: never[]) => Error][] = [
  ["type 11", (f) => (f[5] = 11), SerializationError],
  ["hash variant 1", (f) => (f[6] = 1), UnknownHashVariantError],
  ["a padding byte set", (f) => (f[BODY + 20] = 1), SerializationError],
  [
    "k 100",
    (_, v) => {
      v.setUint32(BODY + 4, 100, true);
    },
    SerializationError,
  ],
  [
    "k 8",
    (_, v) => {
      v.setUint32(BODY + 4, 8, true);
    },
    SerializationError,
  ],
  [
    "k 300, which holds the count but is no power of two",
    (_, v) => {
      v.setUint32(BODY + 4, 300, true);
    },
    SerializationError,
  ],
  [
    "a count the body cannot hold",
    (_, v) => {
      v.setUint32(BODY + 16, v.getUint32(BODY + 16, true) + 1, true);
    },
    TruncatedError,
  ],
  [
    "theta 0",
    (_, v) => {
      setU64(v, BODY + 8, 0);
    },
    SerializationError,
  ],
  [
    "theta above 2^53",
    (_, v) => {
      setU64(v, BODY + 8, 2 ** 53 + 2);
    },
    SerializationError,
  ],
  [
    "a zero hash",
    (_, v) => {
      setU64(v, HASHES, 0);
    },
    SerializationError,
  ],
  [
    "a hash at theta",
    (_, v) => {
      setU64(v, HASHES + 8 * last(v), u64(v, BODY + 8));
    },
    SerializationError,
  ],
  [
    "two hashes out of order",
    (_, v) => {
      const first = hashAt(v, 0);
      setU64(v, HASHES, hashAt(v, 1));
      setU64(v, HASHES + 8, first);
    },
    SerializationError,
  ],
  [
    "a repeated hash",
    (_, v) => {
      setU64(v, HASHES + 8, hashAt(v, 0));
    },
    SerializationError,
  ],
];

test.each(lies)("fromBytes rejects %s", (_, mutate, expected) => {
  const frame = estimating().toBytes();
  mutate(frame, new DataView(frame.buffer));

  expect(() => ThetaSketch.fromBytes(resealed(frame))).toThrow(expected);
});

test("fromBytes rejects more hashes than k keeps", () => {
  expect(() => ThetaSketch.fromBytes(overfull())).toThrow(SerializationError);
});

test("every truncated prefix of a frame is rejected with a typed error", () => {
  const frame = estimating().toBytes();
  for (let n = 0; n < frame.length; n += 37) {
    expect(() => ThetaSketch.fromBytes(frame.subarray(0, n))).toThrow(
      SerializationError,
    );
  }
});
