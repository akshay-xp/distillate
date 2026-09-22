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

/** Cuckoo filter geometry: what a sizing solve determines. */
export interface CuckooSizing {
  /** Fingerprint width in bits. */
  f: number;
  /** Number of 4-slot buckets. */
  buckets: number;
  /** Slot bits per expected key, `4 * f * buckets / n`. */
  bitsPerKey: number;
}

/** Widest fingerprint a slot holds. */
export const CUCKOO_MAX_F = 32;

/**
 * Cuckoo geometry for `n` keys at target FPR `epsilon`: `f` bits from the
 * `2b / epsilon` bound with 4-slot buckets, and enough buckets for 95% load
 * plus `sqrt(n)` slack. At exactly 95%, small tables fail to take `n` keys at
 * about 0.6% of sizes (a few buckets collect more keys than they hold, which
 * more kicks do not fix); the slack removed every failure in about 170k
 * prototype runs and still leaves a million-key filter at 94.6% load.
 */
export function cuckooSizing(n: number, epsilon: number): CuckooSizing {
  assertProbability(epsilon, "epsilon");
  const f = Math.max(4, Math.ceil(Math.log2(8 / epsilon)));
  if (f > CUCKOO_MAX_F) {
    throw new ParamError(
      `epsilon ${String(epsilon)} needs a ${String(f)}-bit fingerprint, above the maximum ${String(CUCKOO_MAX_F)} bits`,
    );
  }
  const buckets = Math.ceil(n / 3.8) + Math.ceil(Math.sqrt(n));
  return { f, buckets, bitsPerKey: (4 * f * buckets) / n };
}
