import { fmix64, R64 } from "../core/hasher.js";

/**
 * Writes the 64-bit checksum of a symbol into `R64`. A function of the symbol
 * alone, because the decoder only ever holds a remote symbol, never its key.
 * The XOR keeps the zero symbol, which fmix64 fixes, off a zero checksum.
 */
export function checksumOf(lo: number, hi: number): void {
  R64[0] = (lo ^ 0x7f4a7c15) >>> 0;
  R64[1] = (hi ^ 0x9e3779b9) >>> 0;
  fmix64();
}

/**
 * Advances the symbol's PRNG at `state[2 * slot]` and `state[2 * slot + 1]`,
 * seeded with its checksum lanes, one xoroshiro64** step and returns the index
 * after `last`. The state is the whole 64-bit checksum because a 32-bit seed
 * repeats across about n^2 / 2^33 pairs of symbols, and a pair sharing a
 * sequence shares every coded symbol, so neither ever peels. The gap is the Go
 * reference's, `(last + 1.5) * (1 / sqrt(u) - 1)` rounded up, with a 32-bit
 * uniform `u` where Go draws 64 bits: index i is then reached with probability
 * about `1 / (1 + i/2)`.
 */
export function nextIndex(
  state: Uint32Array,
  slot: number,
  last: number,
): number {
  const s0 = state[2 * slot] ?? 0;
  let s1 = state[2 * slot + 1] ?? 0;
  const x = Math.imul(s0, 0x9e3779bb);
  const out = Math.imul((x << 5) | (x >>> 27), 5) >>> 0;
  s1 ^= s0;
  state[2 * slot] = ((s0 << 26) | (s0 >>> 6)) ^ s1 ^ (s1 << 9);
  state[2 * slot + 1] = (s1 << 13) | (s1 >>> 19);
  const u = (out + 0.5) / 4294967296;
  return last + Math.ceil((last + 1.5) * (1 / Math.sqrt(u) - 1));
}
