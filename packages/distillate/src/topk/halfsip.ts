/**
 * HalfSipHash-1-3 (Aumasson and Bernstein), the 32-bit keyed PRF Linux uses
 * for hash tables. MurmurHash3 has collisions that hold for every seed, so a
 * secret seed cannot stop crafted keys from sharing a slot; a PRF under a
 * secret key can.
 *
 * The rounds are written out rather than called: a round as a closure
 * measured an order of magnitude slower.
 *
 * @param bytes - The message.
 * @param key - The 64-bit key as two words, low first. An array rather than
 * two numbers: words past 2^30 would be boxed on every call.
 * @param len - How many leading bytes of `bytes` to hash.
 * @param mask - Applied before returning, so a slot index comes back small
 * enough not to be boxed.
 * @returns The 32-bit hash, masked.
 */
export function halfSipHash13(
  bytes: Uint8Array,
  key: Uint32Array,
  len: number = bytes.length,
  mask = 0xffffffff,
): number {
  const k0 = key[0] ?? 0;
  const k1 = key[1] ?? 0;
  let v0 = k0 | 0;
  let v1 = k1 | 0;
  let v2 = (0x6c796765 ^ k0) | 0;
  let v3 = (0x74656462 ^ k1) | 0;
  const end = len & ~3;

  for (let i = 0; i < end; i += 4) {
    const m =
      (bytes[i] ?? 0) |
      ((bytes[i + 1] ?? 0) << 8) |
      ((bytes[i + 2] ?? 0) << 16) |
      ((bytes[i + 3] ?? 0) << 24);
    v3 ^= m;
    v0 = (v0 + v1) | 0;
    v1 = (v1 << 5) | (v1 >>> 27);
    v1 ^= v0;
    v0 = (v0 << 16) | (v0 >>> 16);
    v2 = (v2 + v3) | 0;
    v3 = (v3 << 8) | (v3 >>> 24);
    v3 ^= v2;
    v0 = (v0 + v3) | 0;
    v3 = (v3 << 7) | (v3 >>> 25);
    v3 ^= v0;
    v2 = (v2 + v1) | 0;
    v1 = (v1 << 13) | (v1 >>> 19);
    v1 ^= v2;
    v2 = (v2 << 16) | (v2 >>> 16);
    v0 ^= m;
  }

  // The last block carries the length in its top byte and the tail below it.
  let b = len << 24;
  for (let i = len - 1; i >= end; i--) b |= (bytes[i] ?? 0) << (8 * (i - end));

  // One compression round on the last block, then three finalization rounds.
  v3 ^= b;
  for (let r = 0; r < 4; r++) {
    if (r === 1) {
      v0 ^= b;
      v2 ^= 0xff;
    }
    v0 = (v0 + v1) | 0;
    v1 = (v1 << 5) | (v1 >>> 27);
    v1 ^= v0;
    v0 = (v0 << 16) | (v0 >>> 16);
    v2 = (v2 + v3) | 0;
    v3 = (v3 << 8) | (v3 >>> 24);
    v3 ^= v2;
    v0 = (v0 + v3) | 0;
    v3 = (v3 << 7) | (v3 >>> 25);
    v3 ^= v0;
    v2 = (v2 + v1) | 0;
    v1 = (v1 << 13) | (v1 >>> 19);
    v1 ^= v2;
    v2 = (v2 << 16) | (v2 >>> 16);
  }
  return ((v1 ^ v3) & mask) >>> 0;
}
