import fc from "fast-check";
import { expect, test } from "vitest";

import { BlockedBloomFilter, fillBlock } from "../../src/blocked/blocked.js";
import { measureFpr, sampleStrings } from "../helpers/fpr.js";

const disjoint = (present: readonly string[], absent: string[]): string[] => {
  const seen = new Set(present);
  return absent.filter((k) => !seen.has(k));
};

const popcount = (x: number): number => {
  let n = x >>> 0;
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
};

test("fillBlock confines a key to one block with 8 single-bit lanes", () => {
  const numBlocks = 1024;
  fc.assert(
    fc.property(fc.string(), (key) => {
      const words = new Uint32Array(8);
      const bits = new Uint32Array(8);
      fillBlock(key, numBlocks, 0, words, bits);

      expect((words[0] ?? -1) % 8).toBe(0);
      expect((words[0] ?? -1) / 8).toBeLessThan(numBlocks);
      for (let i = 0; i < 8; i++) {
        expect(words[i]).toBe((words[0] ?? 0) + i);
        expect(popcount(bits[i] ?? 0)).toBe(1);
      }
    }),
  );
});

test("fillBlock is deterministic", () => {
  const a = { words: new Uint32Array(8), bits: new Uint32Array(8) };
  const b = { words: new Uint32Array(8), bits: new Uint32Array(8) };
  fillBlock("user:42", 777, 0, a.words, a.bits);
  fillBlock("user:42", 777, 0, b.words, b.bits);
  expect(a.words).toEqual(b.words);
  expect(a.bits).toEqual(b.bits);
});

test("fillBlock with numBlocks 1 keeps all lanes in [0, 8)", () => {
  const words = new Uint32Array(8);
  const bits = new Uint32Array(8);
  fillBlock("anything", 1, 0, words, bits);
  for (let i = 0; i < 8; i++) expect(words[i]).toBe(i);
});

test("add then has returns true across BytesLike forms", () => {
  const f = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  f.add("alice");
  expect(f.has("alice")).toBe(true);
  f.add(Uint8Array.of(1, 2, 3));
  expect(f.has(Uint8Array.of(1, 2, 3))).toBe(true);

  f.add("AB");
  expect(f.has(Uint8Array.of(65, 66))).toBe(true);
  expect(f.has(Uint8Array.of(65, 66).buffer)).toBe(true);
});

test("no false negatives for any added key (property)", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.string()), (keys) => {
      const f = new BlockedBloomFilter({
        bitsPerKey: 12,
        capacity: 2000,
        seed: 0,
      });
      for (const key of keys) f.add(key);
      for (const key of keys) expect(f.has(key)).toBe(true);
    }),
  );
});

test("bitsPerKey reports numBlocks * 256 / capacity", () => {
  const f = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  const numBlocks = Math.ceil((12 * 1000) / 256);
  expect(f.bitsPerKey).toBe((numBlocks * 256) / 1000);
});

test("create(n, epsilon) sizes so observed FPR stays at or below epsilon", () => {
  const present = sampleStrings(1, 5000);
  for (const [epsilon, count] of [
    [1e-2, 20000],
    [1e-3, 60000],
    [1e-4, 200000],
  ] as const) {
    const absent = disjoint(present, sampleStrings(2, count));
    const f = BlockedBloomFilter.create(5000, epsilon);
    const obs = measureFpr(f, present, absent);
    expect(obs).toBeLessThanOrEqual(epsilon * 1.3);
  }
});

test("create picks bits-per-key monotonically with tighter epsilon", () => {
  const loose = BlockedBloomFilter.create(100000, 0.01).bitsPerKey;
  const tight = BlockedBloomFilter.create(100000, 0.0001).bitsPerKey;
  expect(tight).toBeGreaterThan(loose);
});

test("union merges two filters without mutating inputs", () => {
  const a = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  const b = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 1000 });
  a.add("x");
  b.add("y");

  const u = a.union(b);
  expect(u.has("x")).toBe(true);
  expect(u.has("y")).toBe(true);
  expect(u).not.toBe(a);
  expect(a.has("y")).toBe(false);
  expect(b.has("x")).toBe(false);
});

test("union has every key from either input (property)", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.string()),
      fc.uniqueArray(fc.string()),
      (ka, kb) => {
        const a = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 2000 });
        const b = new BlockedBloomFilter({ bitsPerKey: 12, capacity: 2000 });
        for (const key of ka) a.add(key);
        for (const key of kb) b.add(key);
        const u = a.union(b);
        for (const key of [...ka, ...kb]) expect(u.has(key)).toBe(true);
      },
    ),
  );
});
