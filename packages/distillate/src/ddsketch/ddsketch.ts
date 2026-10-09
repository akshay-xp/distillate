import { assertPositiveFinite, ParamError } from "../core/params.js";
import { type IndexMapping, logMapping } from "./mapping.js";
import { DenseStore } from "./store.js";

/** Options for {@link DDSketch.create}. */
export interface DDSketchOptions {
  /**
   * The mapping factory that bins values. Defaults to {@link logMapping}, the
   * most compact; the interpolated mappings trade bins for speed.
   */
  mapping?: (relativeAccuracy: number) => IndexMapping;
}

/**
 * A quantile sketch whose every answer is within a relative error of the true
 * value at that quantile, tails included.
 */
export class DDSketch {
  readonly #relativeAccuracy: number;
  readonly #mapping: IndexMapping;
  readonly #positive = new DenseStore();
  // Negative values, binned by magnitude.
  readonly #negative = new DenseStore();
  #zeroCount = 0;
  #count = 0;
  #sum = 0;
  #min = Number.NaN;
  #max = Number.NaN;

  /**
   * Builds an empty sketch.
   *
   * @param relativeAccuracy - Relative error bound on every quantile, in `(0, 1)`.
   * @param options - Optional mapping factory.
   * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)`.
   */
  static create(
    relativeAccuracy: number,
    options: DDSketchOptions = {},
  ): DDSketch {
    return new DDSketch(relativeAccuracy, options);
  }

  /** See {@link DDSketch.create}. */
  constructor(relativeAccuracy: number, options: DDSketchOptions = {}) {
    const { mapping = logMapping } = options;
    this.#mapping = mapping(relativeAccuracy);
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
    // bin, then the positives, as sketches-go walks them.
    const rank = q * (this.#count - 1);
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
      this.#positive.add(this.#mapping.index(value), 1);
    } else if (value < -min) {
      this.#negative.add(this.#mapping.index(-value), 1);
    } else {
      this.#zeroCount += 1;
    }
    this.#count += 1;
    this.#sum += value;
    // NaN compares false, so the first value replaces the empty NaN.
    if (!(value >= this.#min)) this.#min = value;
    if (!(value <= this.#max)) this.#max = value;
  }
}
