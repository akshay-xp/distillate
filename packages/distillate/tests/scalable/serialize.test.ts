import fc from "fast-check";
import { expect, test } from "vitest";

import { probes } from "../../src/core/hasher.js";
import {
  bytesEqual,
  FORMAT_VERSION,
  readHeader,
  SerializationError,
} from "../../src/core/serialize.js";
import {
  ScalableBloomFilter,
  type ScalableBloomOptions,
} from "../../src/scalable/scalable.js";

const range = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i)}`);

const filled = (
  keys: string[],
  n = 10,
  options: ScalableBloomOptions = {},
): ScalableBloomFilter => {
  const f = ScalableBloomFilter.create(n, 0.01, options);
  for (const key of keys) f.add(key);
  return f;
};

const examples: [string, string[], ScalableBloomOptions][] = [
  ["empty", [], {}],
  ["one stage", range("s", 5), {}],
  ["three stages", range("t", 60), { growth: 2, tightening: 0.85, seed: 3 }],
];

test.each(examples)(
  "a %s filter round-trips byte-identically",
  (_, keys, options) => {
    const f = filled(keys, 10, options);
    const bytes = f.toBytes();
    const restored = ScalableBloomFilter.fromBytes(bytes);

    expect(restored.equals(f)).toBe(true);
    expect(bytesEqual(restored.toBytes(), bytes)).toBe(true);
    for (const key of [...keys, ...range("miss", 100)]) {
      expect(restored.has(key)).toBe(f.has(key));
    }
  },
);

test("any filter round-trips byte-identically (property)", () => {
  fc.assert(
    fc.property(
      fc.array(fc.string(), { maxLength: 300 }),
      fc.integer({ min: 1, max: 20 }),
      (keys, n) => {
        const bytes = filled(keys, n).toBytes();
        expect(
          bytesEqual(ScalableBloomFilter.fromBytes(bytes).toBytes(), bytes),
        ).toBe(true);
      },
    ),
    { numRuns: 50 },
  );
});

// Reads the frame by the documented layout alone, not through fromBytes, so a
// layout that merely round-trips through its own reader cannot pass.
test("the frame follows the documented layout, with every stage 8-aligned", () => {
  const keys = range("t", 60);
  const f = filled(keys, 10, { seed: 3 });
  const frame = f.toBytes();

  const { type, flags, body } = readHeader(frame);
  expect(type).toBe(6);
  expect(flags).toBe(0);

  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  expect(view.getUint32(0, true)).toBe(10);
  const seed = view.getUint32(4, true);
  expect(seed).toBe(3);
  expect(view.getFloat64(8, true)).toBe(0.01);
  expect(view.getFloat64(16, true)).toBe(2);
  expect(view.getFloat64(24, true)).toBe(0.85);
  const stageCount = view.getUint32(32, true);
  expect(stageCount).toBe(3);
  expect(view.getUint32(36, true)).toBe(0);

  const stages: { m: number; k: number; bits: Uint8Array }[] = [];
  let at = 40 + 16 * stageCount;
  for (let i = 0; i < stageCount; i++) {
    const entry = 40 + 16 * i;
    const m = view.getUint32(entry, true);
    const k = view.getUint16(entry + 4, true);
    expect(view.getUint16(entry + 6, true)).toBe(0);
    const length = Math.ceil(m / 8);
    const padded = Math.ceil(length / 8) * 8;

    expect((16 + at) % 8).toBe(0);
    stages.push({ m, k, bits: body.subarray(at, at + length) });
    expect(Array.from(body.subarray(at + length, at + padded))).toEqual(
      new Array(padded - length).fill(0),
    );
    at += padded;
  }
  expect(at).toBe(body.length);

  for (const key of keys) {
    const held = stages.some(({ m, k, bits }) =>
      Array.from(probes(key, k, m, seed)).every(
        (i) => ((bits[i >>> 3] ?? 0) & (1 << (i & 7))) !== 0,
      ),
    );
    expect(held, key).toBe(true);
  }
});

test("the JSON envelope round-trips", () => {
  const f = filled(range("j", 60));
  const json = f.toJSON();
  expect(json.$).toBe("distillate");
  expect(json.v).toBe(FORMAT_VERSION);

  const restored = ScalableBloomFilter.fromJSON(
    JSON.parse(JSON.stringify(json)),
  );
  expect(restored.equals(f)).toBe(true);
  expect(() => ScalableBloomFilter.fromJSON({})).toThrow(SerializationError);
});
