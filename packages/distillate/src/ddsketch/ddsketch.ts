import { assertPositiveFinite, ParamError } from "../core/params.js";
import {
  FORMAT_VERSION,
  readHeader,
  SerializationError,
  writeFrame,
} from "../core/serialize.js";
import {
  type IndexMapping,
  logMapping,
  type MappingKind,
  mappingWithGamma,
} from "./mapping.js";
import {
  collapsingHighestStore,
  collapsingLowestStore,
  denseStore,
  sparseStore,
  type Store,
  type StoreFactory,
  type StoreKind,
} from "./store.js";

const TYPE = 10;
// DDSketch bins values by its mapping and hashes nothing, so the header's
// hash-variant nibble is always 0.
const NO_HASH = 0;
const PARAMS_SIZE = 64;
// posBins and negBins, ahead of the bin arrays.
const COUNTS_SIZE = 8;

// Wire codes, by position. The mapping codes are Datadog's protobuf
// Interpolation values.
const MAPPING_CODES: readonly MappingKind[] = [
  "log",
  "linear",
  "quadratic",
  "cubic",
];
const STORE_CODES: readonly StoreKind[] = [
  "dense",
  "collapsingLowest",
  "collapsingHighest",
  "sparse",
];

function storeOf(kind: StoreKind, maxBins: number): StoreFactory {
  switch (kind) {
    case "dense":
      return denseStore();
    case "sparse":
      return sparseStore();
    case "collapsingLowest":
      return collapsingLowestStore(maxBins);
    case "collapsingHighest":
      return collapsingHighestStore(maxBins);
  }
}

function binsOf(store: Store): { indices: number[]; counts: number[] } {
  const indices: number[] = [];
  const counts: number[] = [];
  store.forEach((index, count) => {
    indices.push(index);
    counts.push(count);
  });
  return { indices, counts };
}

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

/** Thrown by {@link DDSketch.union} when the two sketches' bins differ. */
export class DDSketchParamMismatchError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "DDSketchParamMismatchError";
}

// sketches-go's tolerance for treating two mappings as one: Math.pow and Go's
// Pow can put the same accuracy's gamma an ulp apart.
function withinTolerance(x: number, y: number): boolean {
  return Math.abs(x - y) <= 1e-12 * Math.max(Math.abs(x), Math.abs(y));
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

  /**
   * Restores a sketch from its {@link DDSketch.toBytes} serialization.
   *
   * @param bytes - The serialized sketch.
   * @returns The reconstructed sketch.
   * @throws {@link SerializationError} when the frame is malformed or not a
   * DDSketch.
   */
  static fromBytes(bytes: Uint8Array): DDSketch {
    const { type, body } = readHeader(bytes);
    if (type !== TYPE) {
      throw new SerializationError(
        `expected DSTL type ${String(TYPE)}, got ${String(type)}`,
      );
    }
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const kind = MAPPING_CODES[view.getUint8(0)] ?? "log";
    const storeKind = STORE_CODES[view.getUint8(1)] ?? "dense";
    const maxBins = view.getUint32(4, true);
    const gamma = view.getFloat64(8, true);
    const indexOffset = view.getFloat64(16, true);
    const sketch = new DDSketch(view.getFloat64(24, true), {
      mapping: () => mappingWithGamma(kind, gamma, indexOffset),
      store: storeOf(storeKind, maxBins),
    });
    const posBins = view.getUint32(PARAMS_SIZE, true);
    const negBins = view.getUint32(PARAMS_SIZE + 4, true);
    const counts = PARAMS_SIZE + COUNTS_SIZE;
    const indices = counts + 8 * (posBins + negBins);
    const zeroCount = view.getFloat64(56, true);
    let total = zeroCount;
    for (let i = 0; i < posBins + negBins; i++) {
      const count = view.getFloat64(counts + 8 * i, true);
      const index = view.getInt32(indices + 4 * i, true);
      (i < posBins ? sketch.#positive : sketch.#negative).add(index, count);
      total += count;
    }
    sketch.#zeroCount = zeroCount;
    sketch.#count = total;
    sketch.#sum = view.getFloat64(32, true);
    sketch.#min = view.getFloat64(40, true);
    sketch.#max = view.getFloat64(48, true);
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
   * @throws {@link DDSketchParamMismatchError} when the mappings differ in
   * kind, or in `gamma` or `indexOffset` by more than 1e-12 relative.
   */
  union(other: DDSketch): DDSketch {
    const mine = this.#mapping;
    const theirs = other.#mapping;
    if (
      mine.kind !== theirs.kind ||
      !withinTolerance(mine.gamma, theirs.gamma) ||
      !withinTolerance(mine.indexOffset, theirs.indexOffset)
    ) {
      throw new DDSketchParamMismatchError(
        "cannot union DDSketches whose mappings bin values differently",
      );
    }
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
   * Serializes the sketch into a self-describing DSTL frame (type 10): its
   * mapping and store, summaries, and each sign's non-empty bins in ascending
   * index order, so equal sketches give equal bytes.
   *
   * @returns The serialized sketch, readable by {@link DDSketch.fromBytes}.
   */
  toBytes(): Uint8Array {
    const pos = binsOf(this.#positive);
    const neg = binsOf(this.#negative);
    const counts = [...pos.counts, ...neg.counts];
    const indices = [...pos.indices, ...neg.indices];
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: NO_HASH },
      PARAMS_SIZE,
      COUNTS_SIZE + 12 * counts.length,
      (_, view) => {
        view.setUint8(0, MAPPING_CODES.indexOf(this.#mapping.kind));
        view.setUint8(1, STORE_CODES.indexOf(this.#store.kind));
        view.setUint32(4, this.#store.maxBins, true);
        view.setFloat64(8, this.#mapping.gamma, true);
        view.setFloat64(16, this.#mapping.indexOffset, true);
        view.setFloat64(24, this.#relativeAccuracy, true);
        view.setFloat64(32, this.#sum, true);
        view.setFloat64(40, this.#min, true);
        view.setFloat64(48, this.#max, true);
        view.setFloat64(56, this.#zeroCount, true);
        view.setUint32(PARAMS_SIZE, pos.counts.length, true);
        view.setUint32(PARAMS_SIZE + 4, neg.counts.length, true);
        const at = PARAMS_SIZE + COUNTS_SIZE;
        counts.forEach((count, i) => {
          view.setFloat64(at + 8 * i, count, true);
        });
        indices.forEach((index, i) => {
          view.setInt32(at + 8 * counts.length + 4 * i, index, true);
        });
      },
    );
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
    // -0 + 0 is +0. Without this, [0, -0] and [-0, 0] would leave different
    // min bits and the same data would serialize to different bytes.
    value += 0;
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
