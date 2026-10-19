import { assertUint32, ParamError } from "../core/params.js";
import { KLL_MAX_K, KLL_MIN_K, kllRankError, kllSizing } from "./sizing.js";

/** Construction parameters for a {@link KllSketch}. */
export interface KllParams {
  /** Items the top level holds, an integer in [8, 65535]; defaults to `200`. */
  k?: number;
  /**
   * Seed for the coin flips compaction makes. Give one to make a stream's
   * sketch reproducible; without one, a random seed is drawn.
   */
  seed?: number;
}

/**
 * A KLL sketch: quantiles and ranks of a stream of numbers, each within a
 * rank error of about `1.3%` at the default `k`, in memory fixed by `k`.
 *
 * @example
 * ```ts
 * const latency = KllSketch.create(0.01);
 * latency.add(12.5);
 * ```
 */
export class KllSketch {
  readonly #k: number;
  // Level h occupies #items[#levels[h], #levels[h + 1]); an item there stands
  // for 2^h values of the stream.
  #items: Float64Array;
  #levels: number[] = [0, 0];
  #n = 0;
  #min = Number.NaN;
  #max = Number.NaN;

  /**
   * Creates a sketch at an explicit `k`.
   *
   * @param params - Accuracy and optional seed.
   */
  constructor({ k = 200, seed }: KllParams = {}) {
    if (!Number.isInteger(k) || k < KLL_MIN_K || k > KLL_MAX_K) {
      throw new ParamError(
        `k must be an integer in [${String(KLL_MIN_K)}, ${String(KLL_MAX_K)}], got ${String(k)}`,
      );
    }
    if (seed !== undefined) assertUint32(seed, "seed");
    this.#k = k;
    this.#items = new Float64Array(k);
  }

  /**
   * Creates a sketch whose single-rank error meets `rankError`.
   *
   * @param rankError - Target normalized rank error, e.g. `0.01` for 1%.
   * @returns A new, empty sketch.
   */
  static create(rankError: number): KllSketch {
    return new KllSketch(kllSizing(rankError));
  }

  /** Items the top level holds. */
  get k(): number {
    return this.#k;
  }

  /** Values recorded, weights included. */
  get count(): number {
    return this.#n;
  }

  /** Whether no value has been recorded. */
  get isEmpty(): boolean {
    return this.#n === 0;
  }

  /** Items the sketch holds. */
  get retained(): number {
    return (this.#levels.at(-1) ?? 0) - (this.#levels[0] ?? 0);
  }

  /** Levels of compaction, `1` until the first. */
  get numLevels(): number {
    return this.#levels.length - 1;
  }

  /** The smallest value recorded, exactly; `NaN` while empty. */
  get min(): number {
    return this.#min;
  }

  /** The largest value recorded, exactly; `NaN` while empty. */
  get max(): number {
    return this.#max;
  }

  /**
   * Rank error at 99% confidence, as a fraction of `count`.
   *
   * @param pmf - `true` for the error over every rank of a CDF or PMF at
   * once, `false` (the default) for a single rank or quantile.
   * @returns The normalized rank error.
   */
  normalizedRankError(pmf = false): number {
    return kllRankError(this.#k, pmf);
  }

  /**
   * The value at quantile `q`: the item at rank `floor(q * (count - 1))` of
   * the stream, within the rank error. `q = 0` and `q = 1` give `min` and
   * `max` exactly.
   *
   * @param q - The quantile, in `[0, 1]`.
   * @returns The estimate, or `NaN` when the sketch is empty.
   * @throws {@link ParamError} when `q` is outside `[0, 1]`.
   */
  quantile(q: number): number {
    if (!(q >= 0 && q <= 1)) {
      throw new ParamError(`q must be in [0, 1], got ${String(q)}`);
    }
    if (this.#n === 0) return Number.NaN;
    return this.#items[0] ?? Number.NaN;
  }

  /** {@link KllSketch.quantile} for each of `qs`, in order. */
  quantiles(qs: readonly number[]): number[] {
    return qs.map((q) => this.quantile(q));
  }

  /**
   * The fraction of the stream at or below `x`, within the rank error.
   *
   * @param x - Any number but `NaN`.
   * @returns The rank in `[0, 1]`, or `NaN` when the sketch is empty.
   */
  rank(x: number): number {
    if (this.#n === 0) return Number.NaN;
    return x >= this.#max ? 1 : 0;
  }
}
