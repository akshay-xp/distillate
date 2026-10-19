import { describe, expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import {
  FORMAT_VERSION,
  SerializationError,
  TruncatedError,
  UnknownHashVariantError,
  writeHeader,
} from "../../src/core/serialize.js";
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

describe("equals and JSON", () => {
  const stream = shuffled(10_000);

  test("equals holds for the same stream and seed, and only then", () => {
    const a = sketchOf(stream, 200, 7);
    expect(a.equals(sketchOf(stream, 200, 7))).toBe(true);
    expect(a.equals(sketchOf(stream, 200, 8))).toBe(false);
    expect(a.equals(sketchOf(stream, 100, 7))).toBe(false);
    const more = sketchOf(stream, 200, 7);
    more.add(1);
    expect(a.equals(more)).toBe(false);
  });

  test("a sketch round-trips through JSON", () => {
    const s = sketchOf(stream, 200, 7);
    const restored = KllSketch.fromJSON(JSON.parse(JSON.stringify(s)));
    expect(restored.equals(s)).toBe(true);
  });
});

describe("fromBytes rejects", () => {
  // Recomputes the trailer so a mutation reaches the check under test instead
  // of stopping at ChecksumError.
  const resealed = (frame: Uint8Array): Uint8Array => {
    new DataView(frame.buffer, frame.byteOffset).setUint32(
      frame.length - 4,
      crc32(frame.subarray(0, frame.length - 4)),
      true,
    );
    return frame;
  };
  const payloadOf = (v: DataView): number =>
    BODY + Math.ceil((36 + 4 * v.getUint32(BODY + 32, true)) / 8) * 8;
  const sizeOf = (v: DataView, h: number): number =>
    v.getUint32(BODY + 36 + 4 * h, true);

  const lies: [string, (frame: Uint8Array, v: DataView) => void][] = [
    ["another structure type", (f) => (f[5] = 13)],
    [
      "an unknown item type",
      (_, v) => {
        v.setUint8(BODY, 1);
      },
    ],
    [
      "a reserved flag bit",
      (_, v) => {
        v.setUint8(BODY + 1, 1 | 2);
      },
    ],
    [
      "a state while unseeded",
      (_, v) => {
        v.setUint8(BODY + 1, 0);
      },
    ],
    [
      "a k below 8",
      (_, v) => {
        v.setUint16(BODY + 2, 7, true);
      },
    ],
    [
      "no levels",
      (_, v) => {
        v.setUint32(BODY + 32, 0, true);
      },
    ],
    [
      "65 levels",
      (_, v) => {
        v.setUint32(BODY + 32, 65, true);
      },
    ],
    [
      "level sizes the body disagrees with",
      (_, v) => {
        v.setUint32(BODY + 36, sizeOf(v, 0) + 1, true);
      },
    ],
    [
      "an n the level weights disagree with",
      (_, v) => {
        v.setUint32(BODY + 8, v.getUint32(BODY + 8, true) + 1, true);
      },
    ],
    [
      "level 1 out of order",
      (_, v) => {
        const at = payloadOf(v) + 8 * sizeOf(v, 0);
        const first = v.getFloat64(at, true);
        v.setFloat64(at, v.getFloat64(at + 8, true), true);
        v.setFloat64(at + 8, first, true);
      },
    ],
    [
      "a NaN item",
      (_, v) => {
        v.setFloat64(payloadOf(v), Number.NaN, true);
      },
    ],
    [
      "a min above an item",
      (_, v) => {
        v.setFloat64(BODY + 16, 1e12, true);
      },
    ],
    [
      "a max below an item",
      (_, v) => {
        v.setFloat64(BODY + 24, -1e12, true);
      },
    ],
  ];

  test.each(lies)("%s", (_, mutate) => {
    const frame = sketchOf(shuffled(10_000), 200, 3).toBytes();
    mutate(frame, new DataView(frame.buffer, frame.byteOffset));
    expect(() => KllSketch.fromBytes(resealed(frame))).toThrow(
      SerializationError,
    );
  });

  test("nonzero padding after the level sizes", () => {
    // 201 values at k 200 compact once: two levels, so 44 bytes of params
    // padded to 48.
    const frame = sketchOf(shuffled(201), 200, 3).toBytes();
    const v = new DataView(frame.buffer, frame.byteOffset);
    expect(v.getUint32(BODY + 32, true)).toBe(2);
    v.setUint8(BODY + 44, 1);
    expect(() => KllSketch.fromBytes(resealed(frame))).toThrow(
      SerializationError,
    );
  });

  test("an empty frame with a min other than NaN", () => {
    const frame = new KllSketch().toBytes();
    new DataView(frame.buffer, frame.byteOffset).setFloat64(BODY + 16, 0, true);
    expect(() => KllSketch.fromBytes(resealed(frame))).toThrow(
      SerializationError,
    );
  });

  test("more items than k leaves room for", () => {
    // Nine items of weight 1 on one level at k 8: consistent in every other
    // respect, but the level holds at most eight.
    const body = new Uint8Array(40 + 8 * 9);
    const v = new DataView(body.buffer);
    v.setUint16(2, 8, true);
    v.setUint32(8, 9, true);
    v.setFloat64(16, 0, true);
    v.setFloat64(24, 8, true);
    v.setUint32(32, 1, true);
    v.setUint32(36, 9, true);
    for (let i = 0; i < 9; i++) v.setFloat64(40 + 8 * i, i, true);
    const frame = writeHeader(
      { version: FORMAT_VERSION, type: 14, flags: 0 },
      body,
    );
    expect(() => KllSketch.fromBytes(frame)).toThrow(SerializationError);
  });

  test("a hash variant other than 0", () => {
    const frame = sketchOf([1, 2, 3]).toBytes();
    frame[6] = 1;
    expect(() => KllSketch.fromBytes(resealed(frame))).toThrow(
      UnknownHashVariantError,
    );
  });

  test("every truncated prefix, as truncated", () => {
    const frame = sketchOf(shuffled(10_000), 200, 3).toBytes();
    for (let n = 0; n < frame.length; n++) {
      expect(() => KllSketch.fromBytes(frame.subarray(0, n))).toThrow(
        TruncatedError,
      );
    }
  });
});
