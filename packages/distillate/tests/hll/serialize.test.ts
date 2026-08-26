import { expect, test } from "vitest";

import { BloomFilter } from "../../src/bloom/bloom.js";
import { crc32 } from "../../src/core/crc32.js";
import {
  FORMAT_VERSION,
  SerializationError,
  TruncatedError,
  writeHeader,
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

// A sparse sketch counts exactly where a dense one estimates, so writing it out
// as registers would lose the property even where the registers still matched.
test("a sparse sketch is written as entries, not as registers", () => {
  const sparse = sketchOf(100).toBytes();
  const dense = sketchOf(5000).toBytes();

  // 16 header + 6 params + 12288 registers + 4 CRC.
  expect(dense.length).toBe(12_314);
  expect(sparse.length).toBeLessThan(1000);
  // The body opens after the 16-byte header: p, then the encoding byte.
  expect(sparse[17]).toBe(1);
  expect(dense[17]).toBe(0);
});

test("a sparse sketch round-trips and still counts exactly", () => {
  const sketch = sketchOf(100);
  expect(sketch.count()).toBe(100);

  const restored = HyperLogLog.fromBytes(sketch.toBytes());
  expect(restored.equals(sketch)).toBe(true);
  expect(restored.count()).toBe(100);
});

test("an empty sketch round-trips", () => {
  const sketch = new HyperLogLog({ p: 14 });
  const restored = HyperLogLog.fromBytes(sketch.toBytes());
  expect(restored.equals(sketch)).toBe(true);
  expect(restored.count()).toBe(0);
});

test("a restored sparse sketch keeps taking keys", () => {
  const sketch = sketchOf(100);
  const restored = HyperLogLog.fromBytes(sketch.toBytes());
  for (let i = 100; i < 200; i++) restored.add(`ser:${String(i)}`);
  expect(restored.count()).toBe(200);
});

test("a sparse payload that is not whole entries is rejected", () => {
  const frame = sketchOf(100).toBytes();
  // Drop one byte from the body and restate the declared length, so the frame
  // is well-formed right up to the entry arithmetic.
  const cut = new Uint8Array(frame.length - 1);
  cut.set(frame.subarray(0, frame.length - 5));
  const view = new DataView(cut.buffer);
  view.setUint32(8, cut.length - 20, true);
  view.setUint32(cut.length - 4, crc32(cut.subarray(0, cut.length - 4)), true);

  expect(() => HyperLogLog.fromBytes(cut)).toThrow(TruncatedError);
});

test("a sparse payload larger than the buffer at that precision is rejected", () => {
  // p=4 holds three entries; hand it four.
  const body = new Uint8Array(6 + 4 * 4);
  body[0] = 4;
  body[1] = 1;
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 0 },
    body,
  );
  expect(() => HyperLogLog.fromBytes(frame)).toThrow(TruncatedError);
});

test("a frame of another structure is rejected", () => {
  const bloom = new BloomFilter({ m: 64, k: 3 });
  bloom.add("alice");
  expect(() => HyperLogLog.fromBytes(bloom.toBytes())).toThrow(
    SerializationError,
  );
});
