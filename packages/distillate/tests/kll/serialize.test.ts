import { describe, expect, test } from "vitest";

import { KllSketch } from "../../src/kll/kll.js";
import { shuffled } from "../helpers/kll.js";

const BODY = 16;

function sketchOf(
  values: readonly number[],
  k = 200,
  seed?: number,
): KllSketch {
  const sketch = new KllSketch(seed === undefined ? { k } : { k, seed });
  for (const v of values) sketch.add(v);
  return sketch;
}

const u64 = (view: DataView, at: number): number =>
  view.getUint32(at + 4, true) * 2 ** 32 + view.getUint32(at, true);

describe("frame type 14", () => {
  test("follows the documented layout", () => {
    const sketch = sketchOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8, 5);
    const frame = sketch.toBytes();
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

    expect(frame[5]).toBe(14);
    expect(frame[6]).toBe(0);
    expect(view.getUint8(BODY)).toBe(0);
    expect(view.getUint8(BODY + 1)).toBe(1);
    expect(view.getUint16(BODY + 2, true)).toBe(8);
    expect(view.getUint32(BODY + 4, true)).not.toBe(0);
    expect(u64(view, BODY + 8)).toBe(10);
    expect(view.getFloat64(BODY + 16, true)).toBe(1);
    expect(view.getFloat64(BODY + 24, true)).toBe(10);
    const levels = view.getUint32(BODY + 32, true);
    expect(levels).toBe(sketch.numLevels);
    const sizes = Array.from({ length: levels }, (_, h) =>
      view.getUint32(BODY + 36 + 4 * h, true),
    );
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(sketch.retained);
    const payload = BODY + Math.ceil((36 + 4 * levels) / 8) * 8;
    expect(payload % 8).toBe(0);
    for (let at = BODY + 36 + 4 * levels; at < payload; at++) {
      expect(frame[at]).toBe(0);
    }
    let at = payload + 8 * (sizes[0] ?? 0);
    for (const size of sizes.slice(1)) {
      const level = Array.from({ length: size }, (_, i) =>
        view.getFloat64(at + 8 * i, true),
      );
      expect(level).toEqual([...level].sort((x, y) => x - y));
      at += 8 * size;
    }
  });

  const examples: [string, () => KllSketch][] = [
    ["empty", () => new KllSketch()],
    ["exact unseeded", () => sketchOf([3, 1, 2, 5, 4])],
    ["compacted", () => sketchOf(shuffled(10_000), 200, 3)],
    [
      "weighted",
      () => {
        const s = sketchOf(shuffled(1000), 50, 4);
        s.add(17, 1000);
        s.add(-3, 5);
        return s;
      },
    ],
    [
      "a union",
      () =>
        sketchOf(shuffled(5000), 200, 5).union(
          sketchOf(
            shuffled(7000).map((v) => v + 0.5),
            100,
            6,
          ),
        ),
    ],
  ];

  test.each(examples)("a %s sketch round-trips byte-identically", (_, make) => {
    const sketch = make();
    const bytes = sketch.toBytes();
    const restored = KllSketch.fromBytes(bytes);
    expect(restored.toBytes()).toEqual(bytes);
    for (let i = 0; i <= 10; i++) {
      expect(restored.quantile(i / 10)).toBe(sketch.quantile(i / 10));
    }
  });

  test("the same stream and seed give the same bytes", () => {
    const stream = shuffled(10_000);
    expect(sketchOf(stream, 200, 7).toBytes()).toEqual(
      sketchOf(stream, 200, 7).toBytes(),
    );
  });

  test("a decoded sketch goes on as the original would", () => {
    const original = sketchOf(shuffled(10_000), 200, 7);
    const decoded = KllSketch.fromBytes(original.toBytes());
    for (const s of [original, decoded]) {
      for (let v = 10_000; v < 20_000; v++) s.add(v);
    }
    expect(decoded.toBytes()).toEqual(original.toBytes());
  });

  test("an unseeded sketch decodes unseeded, and draws its seed later", () => {
    const frame = sketchOf([3, 1, 2]).toBytes();
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint8(BODY + 1)).toBe(0);
    expect(view.getUint32(BODY + 4, true)).toBe(0);
    const decoded = KllSketch.fromBytes(frame);
    for (let v = 0; v < 10_000; v++) decoded.add(v);
    expect(decoded.numLevels).toBeGreaterThan(1);
  });
});
