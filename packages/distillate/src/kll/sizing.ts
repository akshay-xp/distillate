import { assertProbability, ParamError } from "../core/params.js";

/** KLL sketch geometry: the `KllParams` fields a sizing solve determines. */
export interface KllSizing {
  /** Items the top level holds; larger is more accurate. */
  k: number;
}

/** Smallest and largest `k` a sketch may use. */
export const KLL_MIN_K = 8;
export const KLL_MAX_K = 65_535;

/**
 * Normalized rank error at 99% confidence: Apache DataSketches' empirical fits
 * for a single rank, or with `pmf` for every rank of a CDF at once.
 */
export function kllRankError(k: number, pmf: boolean): number {
  return pmf ? 2.446 / k ** 0.9433 : 2.296 / k ** 0.9723;
}

/**
 * Smallest `k` whose single-rank error meets `rankError`. Throws
 * {@link ParamError} when even `KLL_MAX_K` cannot.
 */
export function kllSizing(rankError: number): KllSizing {
  assertProbability(rankError, "rankError");
  let k = Math.max(KLL_MIN_K, Math.ceil((2.296 / rankError) ** (1 / 0.9723)));
  // The closed form can land one off either way in floating point.
  while (k > KLL_MIN_K && kllRankError(k - 1, false) <= rankError) k--;
  while (kllRankError(k, false) > rankError) k++;
  if (k > KLL_MAX_K) {
    throw new ParamError(
      `rankError ${String(rankError)} needs k = ${String(k)}, above the maximum ${String(KLL_MAX_K)}`,
    );
  }
  return { k };
}
