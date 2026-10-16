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
 * Advances `state[slot]`, which starts at the symbol's checksum low lane, one
 * mulberry32 step and returns the index after `last`. The gap is the Go
 * reference's, `(last + 1.5) * (1 / sqrt(u) - 1)` rounded up, with a 32-bit
 * uniform `u` where Go draws 64 bits: index i is then reached with probability
 * about `1 / (1 + i/2)`.
 */
export function nextIndex(
  state: Uint32Array,
  slot: number,
  last: number,
): number {
  let t = ((state[slot] ?? 0) + 0x6d2b79f5) | 0;
  state[slot] = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  return last + Math.ceil((last + 1.5) * (1 / Math.sqrt(u) - 1));
}
