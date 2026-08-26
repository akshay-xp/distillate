import { assertUint32, ParamError } from "../core/params.js";
import { HLL_MAX_P, HLL_MIN_P, hllSizing } from "../core/sizing.js";

// Relative standard error of a HyperLogLog with 2**p registers, from the
// original Flajolet analysis. Reported, never used to correct an estimate.
const ERROR_CONSTANT = 1.04;

function assertPrecision(p: number): void {
  if (!Number.isInteger(p) || p < HLL_MIN_P || p > HLL_MAX_P) {
    throw new ParamError(
      `p must be an integer in [${String(HLL_MIN_P)}, ${String(HLL_MAX_P)}], got ${String(p)}`,
    );
  }
}

/** Construction parameters for a {@link HyperLogLog} sketch. */
export interface HllParams {
  /** Precision: the sketch holds `2 ** p` registers. */
  p: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A HyperLogLog sketch: estimates how many distinct keys it has seen, in space
 * fixed by `p` rather than by the cardinality.
 *
 * @example
 * ```ts
 * const sketch = HyperLogLog.create(0.01);
 * sketch.add("alice");
 * ```
 */
export class HyperLogLog {
  readonly #p: number;
  readonly #seed: number;

  /**
   * Creates a sketch at an explicit precision.
   *
   * @param params - Precision and optional hash seed.
   */
  constructor({ p, seed = 0 }: HllParams) {
    assertPrecision(p);
    assertUint32(seed, "seed");
    this.#p = p;
    this.#seed = seed;
  }

  /**
   * Creates a sketch whose standard error meets `relativeError`.
   *
   * @param relativeError - Target relative error, e.g. `0.01` for 1%.
   * @returns A new, empty sketch.
   */
  static create(relativeError: number): HyperLogLog {
    return new HyperLogLog(hllSizing(relativeError));
  }

  /** Precision: the sketch holds `2 ** p` registers. */
  get p(): number {
    return this.#p;
  }

  /** Hash seed the sketch was built with. */
  get seed(): number {
    return this.#seed;
  }

  /** Analytic relative standard error, `1.04 / sqrt(2 ** p)`. */
  get standardError(): number {
    return ERROR_CONSTANT / Math.sqrt(2 ** this.#p);
  }
}
