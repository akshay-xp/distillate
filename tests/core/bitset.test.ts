import fc from "fast-check";
import { expect, test } from "vitest";

import { BitSet } from "../../src/core/bitset.js";

test("set/get stores and retrieves individual bits", () => {
  const bs = new BitSet(64);
  for (let i = 0; i < 64; i++) expect(bs.get(i)).toBe(false);

  bs.set(3);
  bs.set(40);
  expect(bs.get(3)).toBe(true);
  expect(bs.get(40)).toBe(true);
  expect(bs.get(4)).toBe(false);

  bs.set(3);
  expect(bs.get(3)).toBe(true);
});

test("set/get holds every set index (property, up to 2^20 bits)", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.nat({ max: 2 ** 20 - 1 })), (indices) => {
      const bs = new BitSet(2 ** 20);
      for (const i of indices) bs.set(i);
      for (const i of indices) expect(bs.get(i)).toBe(true);
    }),
  );
});

test("indexing is unsigned for indices >= 2^31", () => {
  const bs = new BitSet(2 ** 31 + 8);
  bs.set(2 ** 31 + 3);
  expect(bs.get(2 ** 31 + 3)).toBe(true);
  expect(bs.get(2 ** 31 + 2)).toBe(false);
});

test("count returns the number of set bits", () => {
  const bs = new BitSet(64);
  expect(bs.count()).toBe(0);
  bs.set(1);
  bs.set(1);
  bs.set(63);
  expect(bs.count()).toBe(2);
});

test("count equals the number of distinct set indices (property)", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.nat({ max: 2 ** 20 - 1 })), (indices) => {
      const bs = new BitSet(2 ** 20);
      for (const i of indices) bs.set(i);
      expect(bs.count()).toBe(indices.length);
    }),
  );
});
