import { assertProbability, ParamError } from "../core/params.js";

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
