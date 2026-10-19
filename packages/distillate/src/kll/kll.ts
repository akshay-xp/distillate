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
  // for 2^h values of the stream. Level 0 grows downward into the free space
  // at the front, so the sketch is full when #levels[0] reaches 0.
  #items: Float64Array;
  #levels: number[];
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
    this.#levels = [k, k];
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
    if (q === 0) return this.#min;
    if (q === 1) return this.#max;
    const rank = Math.floor(q * (this.#n - 1));
    const { items, cumulative } = this.#sortedView();
    let i = 0;
    while ((cumulative[i] ?? 0) <= rank) i++;
    return items[i] ?? this.#max;
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
    if (Number.isNaN(x)) throw new ParamError("x must not be NaN");
    if (this.#n === 0) return Number.NaN;
    const items = this.#items;
    const levels = this.#levels;
    let atOrBelow = 0;
    for (let h = 0; h + 1 < levels.length; h++) {
      let below = 0;
      for (let i = levels[h] ?? 0; i < (levels[h + 1] ?? 0); i++) {
        if ((items[i] ?? 0) <= x) below++;
      }
      atOrBelow += below * 2 ** h;
    }
    return atOrBelow / this.#n;
  }

  /**
   * The cumulative distribution at `splits`: the fraction of the stream at or
   * below each, then `1` for everything, each within the rank error.
   *
   * @param splits - Strictly increasing numbers, none `NaN`.
   * @returns `splits.length + 1` fractions; all `NaN` while empty.
   * @throws {@link ParamError} when `splits` are not strictly increasing or
   * hold `NaN`.
   */
  cdf(splits: readonly number[]): number[] {
    splits.forEach((split, i) => {
      if (Number.isNaN(split) || (i > 0 && !(split > (splits[i - 1] ?? 0)))) {
        throw new ParamError(
          `splits must be strictly increasing and not NaN, got ${String(splits)}`,
        );
      }
    });
    if (this.#n === 0) return [...splits, 0].map(() => Number.NaN);
    return [...splits.map((split) => this.rank(split)), 1];
  }

  /**
   * The mass between `splits`: the fraction of the stream at or below the
   * first, then in each interval up to the next, then above the last.
   *
   * @param splits - Strictly increasing numbers, none `NaN`.
   * @returns `splits.length + 1` fractions summing to `1`; all `NaN` while
   * empty.
   * @throws {@link ParamError} as {@link KllSketch.cdf} does.
   */
  pmf(splits: readonly number[]): number[] {
    const cdf = this.cdf(splits);
    return cdf.map((c, i) => c - (i === 0 ? 0 : (cdf[i - 1] ?? 0)));
  }

  /**
   * Records a value.
   *
   * @param value - Any number but `NaN`; infinities and `-0` are ordered as
   * numbers.
   * @throws {@link ParamError} when `value` is `NaN`. Nothing is recorded.
   */
  add(value: number): void {
    if (Number.isNaN(value)) throw new ParamError("value must not be NaN");
    const at = (this.#levels[0] ?? 0) - 1;
    this.#items[at] = value;
    this.#levels[0] = at;
    this.#n++;
    if (!(value >= this.#min)) this.#min = value;
    if (!(value <= this.#max)) this.#max = value;
  }

  // Every item in ascending order, with the stream weight at or below it.
  #sortedView(): { items: Float64Array; cumulative: Float64Array } {
    const levels = this.#levels;
    const start = levels[0] ?? 0;
    const retained = this.retained;
    const order = Array.from({ length: retained }, (_, i) => start + i);
    const source = this.#items;
    order.sort((a, b) => (source[a] ?? 0) - (source[b] ?? 0));
    const items = new Float64Array(retained);
    const cumulative = new Float64Array(retained);
    let total = 0;
    for (let i = 0; i < retained; i++) {
      const at = order[i] ?? 0;
      let h = 0;
      while ((levels[h + 1] ?? 0) <= at) h++;
      total += 2 ** h;
      items[i] = source[at] ?? 0;
      cumulative[i] = total;
    }
    return { items, cumulative };
  }
}
