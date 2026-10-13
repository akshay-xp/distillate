import { ParamError } from "../core/params.js";

/** MinHash geometry: the `MinHashParams` fields a sizing solve determines. */
export interface MinHashSizing {
  /** Slots in the signature. */
  k: number;
}

/**
 * Fewest and most slots a sketch may use. The ceiling bounds densification,
 * which costs about `(k - filled) * k / filled` probes: at 4096 a one-item set
 * densifies in ~16M, where 2^16 would take ~4e9.
 */
export const MINHASH_MIN_K = 2;
export const MINHASH_MAX_K = 4096;

/**
 * Smallest `k` whose worst-case Jaccard standard error `0.5 / sqrt(k)` (at
 * J = 0.5) meets `maxError`. Throws {@link ParamError} when even
 * `MINHASH_MAX_K` cannot.
 */
export function minHashSizing(maxError: number): MinHashSizing {
  if (!Number.isFinite(maxError) || maxError <= 0 || maxError >= 0.5) {
    throw new ParamError(
      `maxError must be in the open interval (0, 0.5), got ${String(maxError)}`,
    );
  }
  const k = Math.max(MINHASH_MIN_K, Math.ceil(1 / (4 * maxError * maxError)));
  if (k > MINHASH_MAX_K) {
    throw new ParamError(
      `maxError ${String(maxError)} needs k ${String(k)}, above the maximum ${String(MINHASH_MAX_K)}`,
    );
  }
  return { k };
}
