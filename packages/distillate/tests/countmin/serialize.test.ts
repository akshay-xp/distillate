import fc from "fast-check";
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
import { CountMinSketch } from "../../src/countmin/countmin.js";
import { sampleStrings } from "../helpers/fpr.js";

const BODY = 16;
const PAYLOAD = 32;

test("the frame follows the documented layout", () => {
  const s = new CountMinSketch({ width: 8, depth: 2, seed: 5 });
  s.add("a");
  const frame = s.toBytes();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  expect(frame[5]).toBe(8);
  expect(frame[6]).toBe(HASH_MURMUR128);
  expect(view.getUint32(BODY + 0, true)).toBe(8);
  expect(view.getUint32(BODY + 4, true)).toBe(2);
  expect(view.getUint32(BODY + 8, true)).toBe(5);
  expect([...frame.subarray(BODY + 12, BODY + 16)]).toEqual([0, 0, 0, 0]);
  expect(view.getUint32(8, true)).toBe(16 + 4 * 8 * 2);

  const counters = Array.from({ length: 16 }, (_, i) =>
    view.getUint32(PAYLOAD + 4 * i, true),
  );
  const set = counters.flatMap((c, i) => (c === 0 ? [] : [i]));

  // One probe per row, each recording the single add.
  expect(set).toHaveLength(2);
  expect(counters.filter((c) => c === 1)).toHaveLength(2);
  expect(set[0]).toBeLessThan(8);
  expect(set[1]).toBeGreaterThanOrEqual(8);
});

const filled = (): CountMinSketch => {
  const s = CountMinSketch.create(0.001, 0.001);
  sampleStrings(51, 500).forEach((key, i) => {
    s.add(key, (i % 7) + 1);
  });
  return s;
};

const examples: [string, () => CountMinSketch][] = [
  ["filled", filled],
  ["single-row", () => new CountMinSketch({ width: 64, depth: 1, seed: 3 })],
  ["empty", () => CountMinSketch.create(0.01, 0.01)],
];

test.each(examples)("a %s sketch round-trips byte-identically", (_, make) => {
  const s = make();
  const restored = CountMinSketch.fromBytes(s.toBytes());
  const probes = sampleStrings(52, 50);

  expect(restored.width).toBe(s.width);
  expect(restored.depth).toBe(s.depth);
  expect(restored.seed).toBe(s.seed);
  expect(restored.total).toBe(s.total);
  expect(probes.map((p) => restored.count(p))).toEqual(
    probes.map((p) => s.count(p)),
  );
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

// Under plain increment every row sums to the total, which is why the frame
// stores no total. A frame whose rows disagree was not written by this format.
test("a frame whose rows disagree on the total is rejected", () => {
  const frame = filled().toBytes();
  const view = new DataView(frame.buffer);
  view.setUint32(PAYLOAD, view.getUint32(PAYLOAD, true) + 1, true);

  expect(() => CountMinSketch.fromBytes(resealed(frame))).toThrow(
    SerializationError,
  );
});

// Counters are u32, so reaching MAX_SAFE_INTEGER needs 2^21 of them in a row.
test("a frame whose rows sum past the safe integer range is rejected", () => {
  const width = 2 ** 21 + 1;
  const body = new Uint8Array(16 + 4 * width);
  const view = new DataView(body.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, 1, true);
  body.fill(0xff, 16);
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 8, flags: HASH_MURMUR128 },
    body,
  );

  expect(() => CountMinSketch.fromBytes(frame)).toThrow(SerializationError);
});

type Mutation = (frame: Uint8Array, view: DataView) => void;

const lies: [string, Mutation, new (...args: never[]) => Error][] = [
  ["type 1", (f) => (f[5] = 1), SerializationError],
  ["hash variant 1", (f) => (f[6] = 1), UnknownHashVariantError],
  ["a params padding byte set", (f) => (f[BODY + 12] = 1), SerializationError],
  [
    "a width the body cannot hold",
    (_, v) => {
      v.setUint32(BODY, 9999, true);
    },
    TruncatedError,
  ],
];

test.each(lies)("fromBytes rejects %s", (_, mutate, expected) => {
  const frame = filled().toBytes();
  mutate(frame, new DataView(frame.buffer));

  expect(() => CountMinSketch.fromBytes(resealed(frame))).toThrow(expected);
});

// A degenerate geometry whose body length agrees with it reaches the
// constructor, where a raw ParamError would escape as a RangeError rather than
// as the SerializationError every other decode failure throws.
const emptyFrame = (width: number, depth: number): Uint8Array => {
  const body = new Uint8Array(16 + 4 * width * depth);
  const view = new DataView(body.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, depth, true);
  return writeHeader(
    { version: FORMAT_VERSION, type: 8, flags: HASH_MURMUR128 },
    body,
  );
};

test.each<[string, number, number]>([
  ["width 0", 0, 5],
  ["depth 0", 7, 0],
  ["both 0", 0, 0],
])("fromBytes rejects a self-consistent frame with %s", (_, width, depth) => {
  expect(() => CountMinSketch.fromBytes(emptyFrame(width, depth))).toThrow(
    SerializationError,
  );
});

test("every truncated prefix of a frame is rejected with a typed error", () => {
  const frame = filled().toBytes();
  for (let n = 0; n < frame.length; n += 97) {
    expect(() => CountMinSketch.fromBytes(frame.subarray(0, n))).toThrow(
      SerializationError,
    );
  }
});

// Arbitrary geometry and counter bytes, sealed with a valid CRC so every frame
// reaches the structure's own checks rather than stopping at the trailer.
const forged = fc
  .tuple(
    fc.nat({ max: 12 }),
    fc.nat({ max: 4 }),
    fc.nat({ max: 0xffff }),
    fc.nat({ max: 255 }),
    fc.array(fc.nat({ max: 0xffffffff }), { maxLength: 48 }),
  )
  .map(([width, depth, seed, pad, counters]) => {
    const body = new Uint8Array(16 + 4 * counters.length);
    const view = new DataView(body.buffer);
    view.setUint32(0, width, true);
    view.setUint32(4, depth, true);
    view.setUint32(8, seed, true);
    body[12] = pad;
    counters.forEach((c, i) => {
      view.setUint32(16 + 4 * i, c, true);
    });
    return writeHeader(
      { version: FORMAT_VERSION, type: 8, flags: HASH_MURMUR128 },
      body,
    );
  });

test("a forged frame yields a working sketch or a typed error (fuzz)", () => {
  fc.assert(
    fc.property(forged, (frame) => {
      try {
        const s = CountMinSketch.fromBytes(frame);
        expect(typeof s.count("probe")).toBe("number");
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
      CountMinSketch.fromBytes(frame);
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
