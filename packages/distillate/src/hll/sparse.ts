import { foldRho } from "./fold.js";
import type { Registers } from "./registers.js";

/**
 * Precision of the sparse representation. A sparse sketch holds far fewer
 * entries than it has room for indices, so it can afford a much finer index
 * than the dense one and count rather than estimate while the cardinality is
 * small: at `2 ** 25` indices, a hundred keys collide with probability
 * ~1.5e-4. The count stays exact to a few thousand keys and drifts above that,
 * so a buffer big enough to hold more (`p >= 15`) outlives the guarantee.
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
 * Writes a buffer of sparse entries into dense registers.
 *
 * A dense index is a prefix of a sparse one, so many sparse entries fold onto
 * one register and the largest rho among them wins, exactly as it would have
 * had the keys gone to the dense path directly.
 *
 * Entries carry the rho they were recorded against, so folding below `fromP`
 * has to recompute it from the index bits being reclaimed. See {@link foldRho}.
 *
 * @param buf - The entry buffer; only `[0, len)` is read.
 * @param len - How much of `buf` is in use.
 * @param fromP - Dense precision the entries' rho values were recorded at.
 * @param registers - Destination registers, raised in place.
 * @param toP - Precision of `registers`; at most `fromP`.
 */
export function foldSparse(
  buf: Int32Array,
  len: number,
  fromP: number,
  registers: Registers,
  toP: number,
): void {
  const d = fromP - toP;
  for (let i = 0; i < len; i++) {
    const entry = buf[i] ?? 0;
    const index = sparseIndex(entry);
    const at = index >>> (SPARSE_P - fromP);
    registers.raise(at >>> d, foldRho(at, sparseRho(entry), d));
  }
}

/**
 * Restates an entry against a coarser precision.
 *
 * The index is untouched, being 25 bits regardless of precision; only the rho
 * has to be recomputed, from the index bits the coarser precision reclaims.
 *
 * @param entry - A value from {@link encodeSparse}.
 * @param fromP - Dense precision the entry's rho was recorded at.
 * @param toP - Dense precision to restate it against; at most `fromP`.
 * @returns The entry as the coarser sketch would have recorded it.
 */
export function refoldSparse(
  entry: number,
  fromP: number,
  toP: number,
): number {
  const index = sparseIndex(entry);
  const rho = foldRho(
    index >>> (SPARSE_P - fromP),
    sparseRho(entry),
    fromP - toP,
  );
  return encodeSparse(index, rho);
}

/**
 * Collapses a buffer of entries in place to one entry per index, holding the
 * largest rho seen for it, sorted ascending.
 *
 * @param buf - The entry buffer; only `[0, len)` is read or written.
 * @param len - How much of `buf` is in use.
 * @returns The number of distinct indices, now occupying `[0, len)`.
 */
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
