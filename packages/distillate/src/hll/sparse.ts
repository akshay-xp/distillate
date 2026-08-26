import type { Registers } from "./registers.js";

/**
 * Precision of the sparse representation. A sparse sketch holds far fewer
 * entries than it has room for indices, so it can afford a much finer index
 * than the dense one and count exactly instead of estimating: at `2 ** 25`
 * indices, a hundred keys collide with probability ~1.5e-4.
 */
export const SPARSE_P = 25;

const RHO_BITS = 6;
const RHO_MASK = (1 << RHO_BITS) - 1;

/**
 * Packs a sparse index and its dense rho into one entry.
 *
 * `SPARSE_P + RHO_BITS` is 31 bits, so an entry is always a positive int32 and
 * survives the signed sort {@link compact} relies on. Storing the *dense* rho
 * rather than a recoverable sparse one is what lets promotion read entries
 * without unpacking anything: rho in the low bits also means sorting orders a
 * run of one index by ascending rho.
 *
 * @param index - Sparse register index, in `[0, 2 ** SPARSE_P)`.
 * @param rho - Dense rho, in `[1, 63]`.
 * @returns The packed entry.
 */
export function encodeSparse(index: number, rho: number): number {
  return (index << RHO_BITS) | rho;
}

/**
 * Reads the sparse index out of an entry.
 *
 * @param entry - A value from {@link encodeSparse}.
 * @returns The sparse register index.
 */
export function sparseIndex(entry: number): number {
  return entry >>> RHO_BITS;
}

/**
 * Reads the dense rho out of an entry.
 *
 * @param entry - A value from {@link encodeSparse}.
 * @returns The dense rho.
 */
export function sparseRho(entry: number): number {
  return entry & RHO_MASK;
}

/**
 * Collapses a buffer of entries in place to one entry per index, holding the
 * largest rho seen for it, sorted ascending.
 *
 * @param buf - The entry buffer; only `[0, len)` is read or written.
 * @param len - How much of `buf` is in use.
 * @returns The number of distinct indices, now occupying `[0, len)`.
 */
/**
 * Writes a buffer of sparse entries into dense registers.
 *
 * A dense index is a prefix of a sparse one, so many sparse entries fold onto
 * one register and the largest rho among them wins, exactly as it would have
 * had the keys gone to the dense path directly.
 *
 * @param buf - The entry buffer; only `[0, len)` is read.
 * @param len - How much of `buf` is in use.
 * @param registers - Destination registers, written in place.
 * @param p - Dense precision.
 */
export function promote(
  buf: Int32Array,
  len: number,
  registers: Registers,
  p: number,
): void {
  const shift = SPARSE_P - p;
  for (let i = 0; i < len; i++) {
    const entry = buf[i] ?? 0;
    registers.raise(sparseIndex(entry) >>> shift, sparseRho(entry));
  }
}

export function compact(buf: Int32Array, len: number): number {
  if (len === 0) return 0;

  buf.subarray(0, len).sort();

  let out = 0;
  for (let i = 0; i < len; i++) {
    const entry = buf[i] ?? 0;
    const next = buf[i + 1] ?? 0;
    // Ascending order puts an index's largest rho last in its run, so keeping
    // only the entry a different index follows keeps the maximum.
    if (i + 1 < len && sparseIndex(next) === sparseIndex(entry)) continue;
    buf[out++] = entry;
  }
  return out;
}
