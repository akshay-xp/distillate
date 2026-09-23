import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import {
  FORMAT_VERSION,
  HASH_MURMUR128,
  SerializationError,
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
