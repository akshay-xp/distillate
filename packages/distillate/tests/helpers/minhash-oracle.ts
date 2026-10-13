import { hash128Key } from "../../src/core/hasher.js";

// Classic k-hash MinHash, the textbook estimator the shipped one-permutation
// sketch is held against: slot i keeps the smallest value an independent hash
// (murmur3 seeded with i) gives any item. O(k) per item, so only for tests.
export function classicSignature(
  items: readonly string[],
  k: number,
): Uint32Array {
  const slots = new Uint32Array(k).fill(0xffffffff);
  for (const item of items) {
    for (let i = 0; i < k; i++) {
      const value = hash128Key(item, i).w0;
      if (value < (slots[i] ?? 0)) slots[i] = value;
    }
  }
  return slots;
}

export function classicJaccard(a: Uint32Array, b: Uint32Array): number {
  let equal = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) equal++;
  }
  return equal / a.length;
}
