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

  /** Records a value. */
  add(value: number): void {
    if (value > this.#mapping.minIndexableValue) {
      this.#positive.add(this.#mapping.index(value), 1);
    }
    this.#count += 1;
    this.#sum += value;
    // NaN compares false, so the first value replaces the empty NaN.
    if (!(value >= this.#min)) this.#min = value;
    if (!(value <= this.#max)) this.#max = value;
  }
}
