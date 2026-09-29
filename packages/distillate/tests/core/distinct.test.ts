import { expect, test } from "vitest";

import { DistinctHashes } from "../../src/core/distinct.js";
import type { Hash128 } from "../../src/core/hasher.js";

const h = (w0: number, w1: number, w2 = 0, w3 = 0): Hash128 => ({
  w0,
  w1,
  w2,
  w3,
});

// Tuples that agree on the low words, the only bits a filter may use, but
// differ above them. Width 4 must keep them apart, as 6c5fcae requires of
// Cuckoo; width 2 must merge them, as Fuse requires.
const lowTwins = [h(1, 2, 3, 4), h(1, 2, 3, 5), h(1, 2, 9, 4)];

test("width 4 keeps tuples that differ only in the high words", () => {
  const set = new DistinctHashes(4);
  for (const t of lowTwins) expect(set.add(t)).toBe(true);

  expect(set.size).toBe(3);
  expect([...set.words]).toEqual([1, 2, 3, 4, 1, 2, 3, 5, 1, 2, 9, 4]);
});

test("width 2 collapses tuples that agree on the low words", () => {
  const set = new DistinctHashes(2);
  expect(lowTwins.map((t) => set.add(t))).toEqual([true, false, false]);

  expect(set.size).toBe(1);
  expect([...set.words]).toEqual([1, 2]);
});

test("a repeat is refused and the first-seen order is kept", () => {
  const set = new DistinctHashes(4);
  const [a, b, c] = [h(7, 0, 0, 1), h(3, 0, 0, 2), h(5, 0, 0, 3)];

  expect([a, b, a, c, b].map((t) => set.add(t))).toEqual([
    true,
    true,
    false,
    true,
    false,
  ]);
  expect([...set.words]).toEqual([7, 0, 0, 1, 3, 0, 0, 2, 5, 0, 0, 3]);
});

test("it grows well past its first table and keeps every tuple in order", () => {
  const set = new DistinctHashes(4);
  const n = 50_000;
  // Unsigned words across the full 32-bit range, including the high bit.
  const tuple = (i: number): Hash128 =>
    h(Math.imul(i, 0x9e3779b1) >>> 0, i, 0xffffffff - i, i ^ 0x80000000);
  for (let i = 0; i < n; i++) set.add(tuple(i));
  for (let i = 0; i < n; i++) expect(set.add(tuple(i))).toBe(false);

  expect(set.size).toBe(n);
  expect(set.words.length).toBe(4 * n);
  for (let i = 0; i < n; i += 997) {
    const t = tuple(i);
    expect([...set.words.subarray(4 * i, 4 * i + 4)]).toEqual([
      t.w0,
      t.w1,
      t.w2,
      t.w3 >>> 0,
    ]);
  }
});
