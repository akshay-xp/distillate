import { expect, test } from "vitest";

import { HASH_MURMUR128 } from "../../src/core/serialize.js";
import { CountMinSketch } from "../../src/countmin/countmin.js";

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
