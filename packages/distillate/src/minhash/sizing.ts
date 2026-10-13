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

/** Asserts `k` is an integer slot count in `[MINHASH_MIN_K, MINHASH_MAX_K]`. */
export function assertK(k: number): void {
  if (!Number.isInteger(k) || k < MINHASH_MIN_K || k > MINHASH_MAX_K) {
    throw new ParamError(
      `k must be an integer in [${String(MINHASH_MIN_K)}, ${String(MINHASH_MAX_K)}], got ${String(k)}`,
    );
  }
}

/** LSH geometry: how a signature of `k` slots is cut into bands. */
export interface LshSizing {
  /** Bands; a pair becomes a candidate when any one band matches. */
  bands: number;
  /** Slots per band; every one must match for the band to. */
  rows: number;
  /**
   * Area under the candidate curve below the threshold: how much
   * probability mass goes to pairs less similar than wanted.
   */
  falsePositive: number;
  /**
   * Area above the curve beyond the threshold: how much mass is missed among
   * pairs at least as similar as wanted.
   */
  falseNegative: number;
}

// Simpson's rule over 200 intervals. The candidate curve is smooth, and the
// search only compares costs against each other, so this is ample.
const INTERVALS = 200;

function integrate(f: (s: number) => number, a: number, b: number): number {
  const h = (b - a) / INTERVALS;
  let sum = f(a) + f(b);
  for (let i = 1; i < INTERVALS; i++) {
    sum += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  }
  return (sum * h) / 3;
}

/**
 * Bands and rows for an LSH index over `k`-slot signatures, chosen as
 * datasketch does: a pair at similarity `s` becomes a candidate with
 * probability `1 - (1 - s^rows)^bands`, and the pair minimising
 * `weights[0] * falsePositive + weights[1] * falseNegative` around
 * `threshold` wins. Balanced weights put the curve's midpoint near the
 * threshold, so pairs just above it are found most of the time, not always.
 * The search tries every split of `k`, so its cost grows with `k`: about
 * 10 ms at 128 and a few hundred ms at 4096.
 *
 * @param threshold - Jaccard similarity that should make a pair a candidate.
 * @param k - Slots in each signature.
 * @param weights - Cost of a false positive and of a false negative; sum to 1.
 */
export function lshSizing(
  threshold: number,
  k: number,
  weights: readonly [number, number] = [0.5, 0.5],
): LshSizing {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
    throw new ParamError(
      `threshold must be in the open interval (0, 1), got ${String(threshold)}`,
    );
  }
  assertK(k);
  const [wfp, wfn] = weights;
  if (!(wfp >= 0) || !(wfn >= 0) || Math.abs(wfp + wfn - 1) > 1e-9) {
    throw new ParamError(
      `weights must be non-negative and sum to 1, got [${String(wfp)}, ${String(wfn)}]`,
    );
  }

  let best: LshSizing = {
    bands: 1,
    rows: 1,
    falsePositive: 0,
    falseNegative: 0,
  };
  let bestCost = Infinity;
  for (let bands = 1; bands <= k; bands++) {
    for (let rows = 1; rows * bands <= k; rows++) {
      const falsePositive = integrate(
        (s) => 1 - (1 - s ** rows) ** bands,
        0,
        threshold,
      );
      const falseNegative = integrate(
        (s) => (1 - s ** rows) ** bands,
        threshold,
        1,
      );
      const cost = wfp * falsePositive + wfn * falseNegative;
      if (cost < bestCost) {
        bestCost = cost;
        best = { bands, rows, falsePositive, falseNegative };
      }
    }
  }
  return best;
}
