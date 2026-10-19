import { expect, test } from "vitest";

import { HASH_MURMUR128 } from "../../src/core/serialize.js";
import { ThetaSketch } from "../../src/theta/theta.js";

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

test("a sketch round-trips through JSON", () => {
  const s = estimating();
  const restored = ThetaSketch.fromJSON(JSON.parse(JSON.stringify(s)));
  expect(restored.equals(s)).toBe(true);
});
