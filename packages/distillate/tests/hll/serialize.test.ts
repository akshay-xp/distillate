import { expect, test } from "vitest";

import { BloomFilter } from "../../src/bloom/bloom.js";
import {
  FORMAT_VERSION,
  SerializationError,
} from "../../src/core/serialize.js";
import { HyperLogLog } from "../../src/hll/hll.js";

const sketchOf = (n: number, p = 14, tag = "ser"): HyperLogLog => {
  const sketch = new HyperLogLog({ p });
  for (let i = 0; i < n; i++) sketch.add(`${tag}:${String(i)}`);
  return sketch;
};

test("a frame declares itself a version 4 DSTL sketch", () => {
  const frame = sketchOf(5000).toBytes();
  expect([...frame.subarray(0, 4)]).toEqual([0x44, 0x53, 0x54, 0x4c]);
  expect(frame[4]).toBe(FORMAT_VERSION);
  expect(frame[5]).toBe(5);
});

test("a dense sketch round-trips to an identical sketch", () => {
  // 5000 keys at p=14 and 10 at p=4 are both well past their buffers.
  for (const [n, p] of [
    [5000, 14],
    [10, 4],
  ] as const) {
    const sketch = sketchOf(n, p);
    const restored = HyperLogLog.fromBytes(sketch.toBytes());
    expect(restored.equals(sketch)).toBe(true);
    expect(restored.count()).toBe(sketch.count());
    expect(restored.p).toBe(p);
    expect(restored.seed).toBe(sketch.seed);
  }
});

test("a seed survives serialization", () => {
  const sketch = new HyperLogLog({ p: 14, seed: 0xdeadbeef });
  for (let i = 0; i < 5000; i++) sketch.add(`seeded:${String(i)}`);
  const restored = HyperLogLog.fromBytes(sketch.toBytes());
  expect(restored.seed).toBe(0xdeadbeef);
  expect(restored.equals(sketch)).toBe(true);
});

test("a frame of another structure is rejected", () => {
  const bloom = new BloomFilter({ m: 64, k: 3 });
  bloom.add("alice");
  expect(() => HyperLogLog.fromBytes(bloom.toBytes())).toThrow(
    SerializationError,
  );
});
