import { expect, test } from "vitest";

import { HASH_MURMUR128 } from "../../src/core/serialize.js";
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
