import { expect, test } from "vitest";

import { HASH_MURMUR128 } from "../../src/core/serialize.js";
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
