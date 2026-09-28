import { expect, test } from "vitest";

import {
  HASH_MURMUR128,
  SerializationError,
} from "../../src/core/serialize.js";
import { TopK } from "../../src/topk/topk.js";
import { zipfStream } from "../helpers/frequency.js";

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test("the frame follows the documented layout", () => {
  const s = new TopK({ capacity: 16, seed: 5 });
  s.add("b", 3);
  s.add("a", 3);
  s.add("c", 7);
  const frame = s.toBytes();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  expect(frame[5]).toBe(9);
  expect(frame[6]).toBe(HASH_MURMUR128);
  expect(view.getUint32(8, true)).toBe(32 + 8 * 3 + 3);

  expect(view.getUint32(16, true)).toBe(16);
  expect(view.getUint32(20, true)).toBe(3);
  expect(view.getFloat64(24, true)).toBe(0);
  expect(view.getFloat64(32, true)).toBe(13);
  expect(view.getUint32(40, true)).toBe(5);
  expect([...frame.subarray(44, 48)]).toEqual([0, 0, 0, 0]);

  // Counts then lengths, both on 4-byte boundaries so a foreign reader can map
  // them as u32 slices; then the keys, heaviest first, ties by key bytes.
  expect(48 % 4).toBe(0);
  expect(60 % 4).toBe(0);
  const u32s = (at: number): number[] =>
    [0, 1, 2].map((i) => view.getUint32(at + 4 * i, true));
  expect(u32s(48)).toEqual([7, 3, 3]);
  expect(u32s(60)).toEqual([1, 1, 1]);
  expect(decode(frame.subarray(72, 75))).toBe("cab");
});

// Without a canonical order the map's insertion history would leak into the
// bytes, and equals could not be byte equality.
test("the same entries produce the same bytes whatever order they arrived in", () => {
  const entries: [string, number][] = [
    ["a", 3],
    ["b", 3],
    ["c", 1],
    ["d", 7],
  ];
  const forward = new TopK({ capacity: 64 });
  for (const [k, n] of entries) forward.add(k, n);
  const reversed = new TopK({ capacity: 64 });
  for (const [k, n] of [...entries].reverse()) reversed.add(k, n);
  const interleaved = new TopK({ capacity: 64 });
  for (let round = 0; round < 7; round++) {
    for (const [k, n] of entries) if (round < n) interleaved.add(k);
  }

  expect(reversed.toBytes()).toEqual(forward.toBytes());
  expect(interleaved.toBytes()).toEqual(forward.toBytes());
});

const filled = (): TopK => {
  const s = new TopK({ capacity: 256, seed: 3 });
  for (let i = 0; i < 100; i++) s.add(`key:${String(i)}`, (i % 7) + 1);
  return s;
};

const purged = (): TopK => {
  const s = new TopK({ capacity: 64 });
  for (const key of zipfStream(61, 2_000, 20_000, 1.1)) s.add(key);
  return s;
};

const withEmptyKey = (): TopK => {
  const s = new TopK({ capacity: 16 });
  s.add("", 3);
  s.add("a", 1);
  return s;
};

const examples: [string, () => TopK][] = [
  ["empty", () => TopK.create(0.01)],
  ["filled", filled],
  ["purged", purged],
  ["empty-key", withEmptyKey],
];

test.each(examples)("a %s sketch round-trips byte-identically", (_, make) => {
  const s = make();
  const restored = TopK.fromBytes(s.toBytes());

  expect(restored.capacity).toBe(s.capacity);
  expect(restored.seed).toBe(s.seed);
  expect(restored.total).toBe(s.total);
  expect(restored.error()).toBe(s.error());
  expect(restored.top(s.capacity)).toEqual(s.top(s.capacity));
  expect(restored.toBytes()).toEqual(s.toBytes());

  // A restored sketch must carry on exactly as the original would, which it
  // cannot if the live entry count was lost: the next purge would land late.
  for (let i = 0; i < 1000; i++) {
    const key = `x:${String(i % 300)}`;
    s.add(key);
    restored.add(key);
  }
  expect(restored.toBytes()).toEqual(s.toBytes());
});

test("the purged example really purged", () => {
  expect(purged().error()).toBeGreaterThan(0);
});

// A zero-length key is a legal key: add("") normalises to empty bytes, and the
// frame carries it as a length of 0.
test("a zero-length key round-trips", () => {
  const restored = TopK.fromBytes(withEmptyKey().toBytes());

  expect(restored.count("")).toBe(3);
  expect(restored.top(1)[0]?.key).toEqual(new Uint8Array(0));
});

test("every truncated prefix of a frame is rejected with a typed error", () => {
  const frame = filled().toBytes();
  for (let n = 0; n < frame.length; n++) {
    expect(() => TopK.fromBytes(frame.subarray(0, n))).toThrow(
      SerializationError,
    );
  }
});
