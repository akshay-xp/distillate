import { assertProbability, ParamError } from "./params.js";

/** Bloom filter geometry: the `BloomParams` fields a sizing solve determines. */
export interface BloomSizing {
  /** Number of bits in the filter. */
  m: number;
  /** Number of hash probes per key. */
  k: number;
}

/** Optimal Bloom-filter sizing: `m` bits and `k` hashes for `n` items at target FPR `epsilon`. */
export function bloomSizing(n: number, epsilon: number): BloomSizing {
  const m = Math.ceil((-n * Math.log(epsilon)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}

/** HyperLogLog geometry: the `HllParams` fields a sizing solve determines. */
export interface HllSizing {
  /** Precision: the sketch holds `2 ** p` registers. */
  p: number;
}

/** Lowest and highest precision a sketch may use. */
export const HLL_MIN_P = 4;
export const HLL_MAX_P = 18;

/**
 * Smallest precision whose standard error `1.04 / sqrt(2 ** p)` meets
 * `relativeError`. Throws {@link ParamError} when even `HLL_MAX_P` cannot.
 */
export function hllSizing(relativeError: number): HllSizing {
  assertProbability(relativeError, "relativeError");
  const p = Math.max(HLL_MIN_P, Math.ceil(2 * Math.log2(1.04 / relativeError)));
  if (p > HLL_MAX_P) {
    throw new ParamError(
      `relativeError ${String(relativeError)} needs precision ${String(p)}, above the maximum ${String(HLL_MAX_P)}`,
    );
  }
  return { p };
}
