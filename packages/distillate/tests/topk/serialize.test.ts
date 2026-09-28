import { expect, test } from "vitest";

import { HASH_MURMUR128 } from "../../src/core/serialize.js";
import { TopK } from "../../src/topk/topk.js";

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
