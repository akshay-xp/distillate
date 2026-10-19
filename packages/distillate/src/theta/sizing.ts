import { assertProbability, ParamError } from "../core/params.js";

/** Theta sketch geometry: the `ThetaParams` fields a sizing solve determines. */
export interface ThetaSizing {
  /** Hashes the sketch samples down to, a power of two. */
  k: number;
}

/** Smallest and largest `k` a sketch may use. */
export const THETA_MIN_K = 16;
export const THETA_MAX_K: number = 2 ** 26;

/**
 * Smallest power-of-two `k` whose relative standard error `1 / sqrt(k)` meets
 * `relativeError`. Throws {@link ParamError} when even `THETA_MAX_K` cannot.
 */
export function thetaSizing(relativeError: number): ThetaSizing {
  assertProbability(relativeError, "relativeError");
  const lgK = Math.ceil(Math.log2(1 / (relativeError * relativeError)));
  const k = Math.max(THETA_MIN_K, 2 ** lgK);
  if (k > THETA_MAX_K) {
    throw new ParamError(
      `relativeError ${String(relativeError)} needs k = ${String(k)}, above the maximum ${String(THETA_MAX_K)}`,
    );
  }
  return { k };
}
