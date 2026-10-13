import type { BytesLike } from "../../src/core/bytes.js";
import { hash128KeyInto, type Hash128 } from "../../src/core/hasher.js";

// Classic k-hash MinHash, the textbook estimator the shipped one-permutation
// sketch is held against: slot i keeps the smallest value an independent hash
// (murmur3 seeded with i) gives any item. O(k) per item, so only for tests.
export function classicSignature(k: number): Uint32Array {
  return new Uint32Array(k).fill(0xffffffff);
}

const scratch: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };

// Adds `item` to every signature given, hashing it once per slot rather than
// once per slot per signature: a shared item costs k hashes, not 2k.
export function classicAdd(
  item: BytesLike,
  ...signatures: Uint32Array[]
): void {
  const k = signatures[0]?.length ?? 0;
  for (let i = 0; i < k; i++) {
    hash128KeyInto(item, i, scratch);
    for (const slots of signatures) {
      if (scratch.w0 < (slots[i] ?? 0)) slots[i] = scratch.w0;
    }
  }
}

export function classicJaccard(a: Uint32Array, b: Uint32Array): number {
  let equal = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) equal++;
  }
  return equal / a.length;
}
