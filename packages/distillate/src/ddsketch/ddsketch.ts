import { assertPositiveFinite, ParamError } from "../core/params.js";
import { type IndexMapping, logMapping } from "./mapping.js";
import {
  collapsingLowestStore,
  type Store,
  type StoreFactory,
} from "./store.js";

/** Options for {@link DDSketch.create}. */
export interface DDSketchOptions {
  /**
   * The mapping factory that bins values. Defaults to {@link logMapping}, the
   * most compact; the interpolated mappings trade bins for speed.
   */
  mapping?: (relativeAccuracy: number) => IndexMapping;
  /**
   * The store factory that holds each sign's bins. Defaults to
   * {@link collapsingLowestStore} at 2048 bins, which bounds memory while
   * keeping the tails accurate.
   */
  store?: StoreFactory;
}

/**
 * A quantile sketch whose every answer is within a relative error of the true
 * value at that quantile, tails included.
 */
export class DDSketch {
  readonly #relativeAccuracy: number;
  readonly #mapping: IndexMapping;
  readonly #store: StoreFactory;
  readonly #positive: Store;
  // Negative values, binned by magnitude.
  readonly #negative: Store;
  #zeroCount = 0;
  #count = 0;
  #sum = 0;
  #min = Number.NaN;
  #max = Number.NaN;

  /**
   * Builds an empty sketch.
   *
   * @param relativeAccuracy - Relative error bound on every quantile, in `(0, 1)`.
   * @param options - Optional mapping and store factories.
   * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)`.
   */
  static create(
    relativeAccuracy: number,
    options: DDSketchOptions = {},
  ): DDSketch {
    return new DDSketch(relativeAccuracy, options);
  }

  /**
   * Builds a sketch holding `values`.
   *
   * @param values - Finite numbers within the mapping's indexable range.
   * @param relativeAccuracy - Relative error bound on every quantile, in `(0, 1)`.
   * @param options - Optional mapping and store factories.
   * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)` or a
   * value cannot be recorded.
   */
  static from(
    values: Iterable<number>,
    relativeAccuracy: number,
    options: DDSketchOptions = {},
  ): DDSketch {
    const sketch = DDSketch.create(relativeAccuracy, options);
    for (const value of values) sketch.add(value);
    return sketch;
  }

  /** See {@link DDSketch.create}. */
  constructor(relativeAccuracy: number, options: DDSketchOptions = {}) {
    const { mapping = logMapping, store = collapsingLowestStore(2048) } =
      options;
    this.#mapping = mapping(relativeAccuracy);
    this.#store = store;
    this.#positive = store.create();
    this.#negative = store.create();
    this.#relativeAccuracy = relativeAccuracy;
  }

  /** The relative error bound the sketch was built for. */
  get relativeAccuracy(): number {
    return this.#relativeAccuracy;
  }

  /** The mapping that bins values. */
  get mapping(): IndexMapping {
    return this.#mapping;
  }

  /** The store factory holding each sign's bins. */
  get store(): StoreFactory {
    return this.#store;
  }

  /** How many values have been added. */
  get count(): number {
    return this.#count;
  }

  /** The sum of every value added. */
  get sum(): number {
    return this.#sum;
  }

  /** The smallest value added, exactly; `NaN` when empty. */
  get min(): number {
    return this.#min;
  }

  /** The largest value added, exactly; `NaN` when empty. */
  get max(): number {
    return this.#max;
  }

  /**
   * Returns a new sketch holding everything this one and `other` have
   * recorded: the same bins, count, min and max one sketch over both streams
   * would hold, with `sum` equal up to float rounding. It takes this sketch's
   * accuracy, mapping and store; both operands are left untouched.
   *
   * @param other - A sketch whose mapping bins values identically.
   * @returns A new sketch holding both streams.
   */
  union(other: DDSketch): DDSketch {
    const merged = new DDSketch(this.#relativeAccuracy, {
      mapping: () => this.#mapping,
      store: this.#store,
    });
    merged.#absorb(this);
    merged.#absorb(other);
    return merged;
  }

  // Adds another sketch's bins and summaries into this one. Bins go through
  // add, so a collapsing store folds the merged range exactly as it would
  // have folded one stream.
  #absorb(from: DDSketch): void {
    if (from.#count === 0) return;
    from.#positive.forEach((index, count) => {
      this.#positive.add(index, count);
    });
    from.#negative.forEach((index, count) => {
      this.#negative.add(index, count);
    });
    this.#zeroCount += from.#zeroCount;
    this.#count += from.#count;
    this.#sum += from.#sum;
    this.#widen(from.#min, from.#max);
  }

  // Extends min and max to cover [lo, hi]. NaN compares false, so an empty
  // sketch takes the first range it is given.
  #widen(lo: number, hi: number): void {
    if (!(lo >= this.#min)) this.#min = lo;
    if (!(hi <= this.#max)) this.#max = hi;
  }

  /**
   * The value at quantile `q`, within `relativeAccuracy` of the exact value at
   * rank `floor(q * (count - 1))`. `q = 0` and `q = 1` give `min` and `max`
   * exactly.
   *
   * @param q - The quantile, in `[0, 1]`.
   * @returns The estimate, or `NaN` when the sketch is empty.
   * @throws {@link ParamError} when `q` is outside `[0, 1]`.
   */
  quantile(q: number): number {
    if (!(q >= 0 && q <= 1)) {
      throw new ParamError(`q must be in [0, 1], got ${String(q)}`);
    }
    if (this.#count === 0) return Number.NaN;
    if (q === 0) return this.#min;
    if (q === 1) return this.#max;
    // Ranks run through the negatives from most negative, then the zero
    // bin, then the positives, as sketches-go walks them. The rank is floored
    // first, where sketches-go keeps it fractional: the negatives are indexed
    // from the far end as total - 1 - rank, which rounds a fractional rank up
    // to the next value and, on a dense stream, past the error bound.
    const rank = Math.floor(q * (this.#count - 1));
    const negatives = this.#negative.total;
    let value: number;
    if (rank < negatives) {
      value = -this.#mapping.value(
        this.#negative.keyAtRank(negatives - 1 - rank),
      );
    } else if (rank < negatives + this.#zeroCount) {
      value = 0;
    } else {
      value = this.#mapping.value(
        this.#positive.keyAtRank(rank - negatives - this.#zeroCount),
      );
    }
    // A bin reads back as one value for everything in it; clamping to what
    // was actually seen can only move the answer closer to the truth.
    return Math.min(Math.max(value, this.#min), this.#max);
  }

  /** {@link DDSketch.quantile} for each of `qs`, in order. */
  quantiles(qs: readonly number[]): number[] {
    return qs.map((q) => this.quantile(q));
  }

  /**
   * Records a value.
   *
   * @param value - Any finite number within the mapping's indexable range.
   * @param count - How many times to record it; finite and positive.
   * @throws {@link ParamError} when `value` is not finite or beyond
   * `mapping.maxIndexableValue` in magnitude, or `count` is not a finite
   * positive number. Nothing is recorded.
   */
  add(value: number, count = 1): void {
    if (!(Math.abs(value) <= this.#mapping.maxIndexableValue)) {
      throw new ParamError(
        `value must be finite and at most ${String(this.#mapping.maxIndexableValue)} in magnitude, got ${String(value)}`,
      );
    }
    assertPositiveFinite(count, "count");
    const min = this.#mapping.minIndexableValue;
    if (value > min) {
      this.#positive.add(this.#mapping.index(value), count);
    } else if (value < -min) {
      this.#negative.add(this.#mapping.index(-value), count);
    } else {
      this.#zeroCount += count;
    }
    this.#count += count;
    this.#sum += value * count;
    this.#widen(value, value);
  }
}
