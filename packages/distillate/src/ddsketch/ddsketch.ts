import { forEachItem } from "../core/iterable.js";
import { assertPositiveFinite, ParamError } from "../core/params.js";
import {
  assertBodyLength,
  assertMinBodyLength,
  bytesEqual,
  type FilterJSON,
  FORMAT_VERSION,
  fromJSONEnvelope,
  readHeader,
  SerializationError,
  toJSONEnvelope,
  TruncatedError,
  UnknownHashVariantError,
  writeFrame,
} from "../core/serialize.js";
import {
  type IndexMapping,
  bitwiseMapping,
  isIndexable,
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
// Each sign's bins are a block: a 16-byte header, then its counts, and for
// pairs its indices, padded to 8 bytes so the next block's header and any f64
// counts stay aligned.
const BLOCK_HEADER = 16;
const CONTIGUOUS = 1;
const F64_COUNTS = 2;

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

// String(-0) is "0", which hides why a -0 was refused.
function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

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

interface Bins {
  indices: number[];
  counts: number[];
  total: number;
}

// How one sign's bins are written, chosen from the bins alone so that equal
// bins give equal bytes: counts as u32 when every one is a whole number that
// fits, else f64; and one contiguous run from the first bin to the last,
// empty slots written as 0, when that is no larger than (count, index) pairs.
interface Layout {
  contiguous: boolean;
  f64: boolean;
  /** Slots in the run, or bins as pairs. */
  n: number;
  /** The run's first index; 0 for pairs. */
  start: number;
  /** Bytes the block takes, header and padding included. */
  size: number;
}

function layoutOf(
  indices: readonly number[],
  counts: readonly number[],
): Layout {
  const f64 = !counts.every((c) => Number.isInteger(c) && c <= 0xffffffff);
  const width = f64 ? 8 : 4;
  const first = indices[0];
  if (first === undefined) {
    return { contiguous: false, f64, n: 0, start: 0, size: BLOCK_HEADER };
  }
  const span = (indices.at(-1) ?? first) - first + 1;
  const contiguous = span * width <= indices.length * (width + 4);
  const n = contiguous ? span : indices.length;
  const data = contiguous ? width * n : (width + 4) * n;
  return {
    contiguous,
    f64,
    n,
    start: contiguous ? first : 0,
    size: BLOCK_HEADER + Math.ceil(data / 8) * 8,
  };
}

function writeBlock(
  view: DataView,
  at: number,
  layout: Layout,
  bins: { indices: readonly number[]; counts: readonly number[] },
): void {
  const { contiguous, f64, n, start } = layout;
  view.setUint8(at, (contiguous ? CONTIGUOUS : 0) | (f64 ? F64_COUNTS : 0));
  view.setUint32(at + 4, n, true);
  view.setInt32(at + 8, start, true);
  const width = f64 ? 8 : 4;
  const data = at + BLOCK_HEADER;
  bins.counts.forEach((count, i) => {
    const index = bins.indices[i] ?? 0;
    const slot = contiguous ? index - start : i;
    if (f64) view.setFloat64(data + 8 * slot, count, true);
    else view.setUint32(data + 4 * slot, count, true);
    if (!contiguous) view.setInt32(data + width * n + 4 * i, index, true);
  });
}

// Reads the sign block at `at`, refusing any a writer could not have
// produced: reserved bits or bytes set, a block running past the body,
// counts that are not finite and positive (a run's empty slots aside),
// indices out of order or outside the mapping's range, a span wider than a
// collapsing store keeps, or a layout other than the one layoutOf picks for
// these bins, which would be a second encoding of the same sketch.
function readBlock(
  view: DataView,
  at: number,
  mapping: IndexMapping,
  maxBins: number,
): Bins & { size: number } {
  const fail = (why: string): SerializationError =>
    new SerializationError(`ddsketch: block at ${String(at)}: ${why}`);
  if (at + BLOCK_HEADER > view.byteLength) {
    throw new TruncatedError(
      `ddsketch: body ends inside the block at ${String(at)}`,
    );
  }
  const layout = view.getUint8(at);
  if ((layout & ~(CONTIGUOUS | F64_COUNTS)) !== 0) {
    throw fail("reserved layout bits are set");
  }
  for (const offset of [1, 2, 3, 12, 13, 14, 15]) {
    if (view.getUint8(at + offset) !== 0)
      throw fail("reserved bytes are not zero");
  }
  const contiguous = (layout & CONTIGUOUS) !== 0;
  const f64 = (layout & F64_COUNTS) !== 0;
  const n = view.getUint32(at + 4, true);
  const start = view.getInt32(at + 8, true);
  if (!contiguous && start !== 0) throw fail("pairs carry a start");
  const width = f64 ? 8 : 4;
  const data = contiguous ? width * n : (width + 4) * n;
  const size = BLOCK_HEADER + Math.ceil(data / 8) * 8;
  if (at + size > view.byteLength) {
    throw new TruncatedError(
      `ddsketch: body ends inside the block at ${String(at)}`,
    );
  }
  for (let b = at + BLOCK_HEADER + data; b < at + size; b++) {
    if (view.getUint8(b) !== 0) throw fail("padding is not zero");
  }

  const lo = mapping.index(mapping.minIndexableValue);
  const hi = mapping.index(mapping.maxIndexableValue);
  const countAt = (i: number): number =>
    f64
      ? view.getFloat64(at + BLOCK_HEADER + 8 * i, true)
      : view.getUint32(at + BLOCK_HEADER + 4 * i, true);
  const bins: Bins & { size: number } = {
    indices: [],
    counts: [],
    total: 0,
    size,
  };
  let previous = -Infinity;
  for (let i = 0; i < n; i++) {
    const count = countAt(i);
    const index = contiguous
      ? start + i
      : view.getInt32(at + BLOCK_HEADER + width * n + 4 * i, true);
    // A run's interior may hold empty slots; its ends, and every pair, may not.
    const end = !contiguous || i === 0 || i === n - 1;
    if (
      !(count >= 0 && count < Infinity) ||
      Object.is(count, -0) ||
      (end && count === 0)
    ) {
      throw fail(`count ${show(count)} is not one a store could hold`);
    }
    if (index <= previous || index < lo || index > hi) {
      throw fail(
        `index ${String(index)} is out of order or outside [${String(lo)}, ${String(hi)}]`,
      );
    }
    previous = index;
    if (count === 0) continue;
    bins.indices.push(index);
    bins.counts.push(count);
    bins.total += count;
  }
  const first = bins.indices[0] ?? 0;
  if (maxBins > 0 && previous - first + 1 > maxBins) {
    throw fail(`bins span more than maxBins ${String(maxBins)}`);
  }
  const canonical = layoutOf(bins.indices, bins.counts);
  if (canonical.contiguous !== contiguous || canonical.f64 !== f64) {
    throw fail("not the layout a writer chooses for these bins");
  }
  return bins;
}

// Whether one side's bins could sum past the largest double: every count at
// its bin's upper edge, with the mapping's slack.
function overflows(mapping: IndexMapping, bins: Bins): boolean {
  let bound = 0;
  bins.indices.forEach((index, i) => {
    bound += (bins.counts[i] ?? 0) * mapping.lowerBound(index + 1);
  });
  return bound * (1 + mapping.relativeAccuracy) >= Number.MAX_VALUE;
}

// Whether sum, min and max could have come from these bins. Bins carry the
// mapping's relative error, so the extremes are checked against bin bounds
// with that much slack: the highest positive bin must not start above max,
// the lowest must not end below min, and the mirror for the negatives.
function summariesHold(
  mapping: IndexMapping,
  pos: Bins,
  neg: Bins,
  zeroCount: number,
  count: number,
  sum: number,
  min: number,
  max: number,
): boolean {
  if (count === 0) return Number.isNaN(min) && Number.isNaN(max) && sum === 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return false;
  }
  if (!Number.isFinite(sum)) {
    // Indexable values can sum past the largest double: to Infinity on a
    // side whose bins could reach it, and to NaN once both sides do.
    const up = overflows(mapping, pos);
    const down = overflows(mapping, neg);
    if (Number.isNaN(sum) ? !(up && down) : !(sum > 0 ? up : down)) {
      return false;
    }
  }
  const slack = 1 + mapping.relativeAccuracy;
  const posFirst = pos.indices[0];
  if (posFirst !== undefined) {
    const posLast = pos.indices.at(-1) ?? posFirst;
    if (max * slack < mapping.lowerBound(posLast)) return false;
    if (min > mapping.lowerBound(posFirst + 1) * slack) return false;
  }
  const negFirst = neg.indices[0];
  if (negFirst !== undefined) {
    const negLast = neg.indices.at(-1) ?? negFirst;
    if (-min * slack < mapping.lowerBound(negLast)) return false;
    if (-max > mapping.lowerBound(negFirst + 1) * slack) return false;
  }
  const tiny = mapping.minIndexableValue;
  return zeroCount === 0 || (min <= tiny && max >= -tiny);
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
   * The mapping factory that bins values. Defaults to {@link bitwiseMapping},
   * the mapping sketches-java's fast sketch uses and the fastest, adding about
   * twice as fast as the log mapping in the benchmarks; take {@link logMapping}
   * for the fewest bins. The interpolated mappings exist to
   * match sketches built with them by Datadog's libraries.
   */
  mapping?: (relativeAccuracy: number) => IndexMapping;
  /**
   * The store factory that holds each sign's bins. Defaults to
   * {@link collapsingLowestStore} at 4096 bins, about 19 orders of magnitude
   * at 1% with the default mapping, which bounds memory while keeping the
   * tails accurate.
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

/** A sketch's bins: each sign's store, and the count of zeros. */
export interface SketchBins {
  positive: Store;
  negative: Store;
  zeroCount: number;
}

/**
 * Reads a sketch's bins. For codecs in this package that write formats other
 * than DSTL; exported from this module but not from the subpath, so it is no
 * part of the public API. Assigned in DDSketch's static block, the one place
 * outside an instance method that can reach its private fields.
 */
export let sketchBins!: (sketch: DDSketch) => SketchBins;

/**
 * Builds a sketch from bins by index: the sketch adding each bin's value, in
 * the bins' order, would hold, without mapping each value back to its index.
 * Package-internal, as {@link sketchBins} is.
 */
export let sketchFromBins!: (
  mapping: IndexMapping,
  store: StoreFactory,
  positive: Map<number, number>,
  negative: Map<number, number>,
  zeroCount: number,
) => DDSketch;

/**
 * A quantile sketch whose every answer is within a relative error of the true
 * value at that quantile, tails included.
 */
export class DDSketch {
  static {
    sketchBins = (sketch) => ({
      positive: sketch.#positive,
      negative: sketch.#negative,
      zeroCount: sketch.#zeroCount,
    });
    sketchFromBins = (mapping, store, positive, negative, zeroCount) => {
      const sketch = new DDSketch(mapping.relativeAccuracy, {
        mapping: () => mapping,
        store,
      });
      sketch.#place(sketch.#positive, positive, 1);
      sketch.#place(sketch.#negative, negative, -1);
      if (zeroCount > 0) sketch.add(0, zeroCount);
      return sketch;
    };
  }

  readonly #relativeAccuracy: number;
  readonly #mapping: IndexMapping;
  // The mapping's range, read on every add, so held here rather than fetched
  // through the mapping each time.
  readonly #minIndexable: number;
  readonly #maxIndexable: number;
  readonly #store: StoreFactory;
  readonly #positive: Store;
  // Negative values, binned by magnitude.
  readonly #negative: Store;
  #zeroCount = 0;
  #count = 0;
  #sum = 0;
  // Infinite until the first value, so add compares plainly against them; the
  // getters report NaN for an empty sketch.
  #min = Infinity;
  #max = -Infinity;

  /**
   * Builds an empty sketch.
   *
   * @param relativeAccuracy - Relative error bound on every quantile, in `(0, 1)`.
   * @param options - Optional mapping and store factories.
   * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)`, or
   * so small that the mapping indexes no value.
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
   * @throws {@link ParamError} when `relativeAccuracy` is outside `(0, 1)` or
   * so small that the mapping indexes no value, or a value cannot be recorded.
   */
  static from(
    values: Iterable<number>,
    relativeAccuracy: number,
    options: DDSketchOptions = {},
  ): DDSketch {
    const sketch = DDSketch.create(relativeAccuracy, options);
    forEachItem(values, (value) => {
      sketch.add(value);
    });
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
    const { type, flags, body } = readHeader(bytes);
    if (type !== TYPE) {
      throw new SerializationError(
        `expected DSTL type ${String(TYPE)}, got ${String(type)}`,
      );
    }
    if ((flags & 0x0f) !== NO_HASH) {
      throw new UnknownHashVariantError(
        `ddsketch hashes nothing, so its hash variant must be 0, got ${String(flags & 0x0f)}`,
      );
    }
    assertMinBodyLength(
      body.length,
      PARAMS_SIZE + 2 * BLOCK_HEADER,
      "ddsketch",
    );
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const kind = MAPPING_CODES[view.getUint8(0)];
    const storeKind = STORE_CODES[view.getUint8(1)];
    if (kind === undefined || storeKind === undefined) {
      throw new SerializationError(
        `ddsketch: unknown mapping ${String(view.getUint8(0))} or store ${String(view.getUint8(1))}`,
      );
    }
    if (view.getUint16(2, true) !== 0) {
      throw new SerializationError("ddsketch: reserved bytes are not zero");
    }
    const maxBins = view.getUint32(4, true);
    const bounded =
      storeKind === "collapsingLowest" || storeKind === "collapsingHighest";
    if (bounded !== maxBins > 0) {
      throw new SerializationError(
        `ddsketch: a ${storeKind} store cannot have maxBins ${String(maxBins)}`,
      );
    }
    const gamma = view.getFloat64(8, true);
    const indexOffset = view.getFloat64(16, true);
    const relativeAccuracy = view.getFloat64(24, true);
    if (!(gamma > 1 && gamma < Infinity) || !Number.isFinite(indexOffset)) {
      throw new SerializationError(
        "ddsketch: gamma must be finite and above 1, and indexOffset finite",
      );
    }
    // No mapping has a -0 offset, and a bitwise one is rebuilt with +0, so a
    // -0 here would decode and then re-encode differently.
    if (Object.is(indexOffset, -0)) {
      throw new SerializationError(
        "ddsketch: indexOffset is -0, which no writer produces",
      );
    }
    if (!(relativeAccuracy > 0 && relativeAccuracy < 1)) {
      throw new SerializationError(
        `ddsketch: relativeAccuracy must be in (0, 1), got ${String(relativeAccuracy)}`,
      );
    }
    const mapping = mappingWithGamma(kind, gamma, indexOffset);
    // An offset far enough out leaves no value a bin, min above max; no
    // sketch was built that way, and every index read below would be garbage.
    if (!isIndexable(mapping)) {
      throw new SerializationError(
        "ddsketch: the mapping leaves no value indexable",
      );
    }
    const pos = readBlock(view, PARAMS_SIZE, mapping, maxBins);
    const neg = readBlock(view, PARAMS_SIZE + pos.size, mapping, maxBins);
    assertBodyLength(
      body.length,
      PARAMS_SIZE + pos.size + neg.size,
      "ddsketch",
    );
    const zeroCount = view.getFloat64(56, true);
    if (!(zeroCount >= 0 && zeroCount < Infinity) || Object.is(zeroCount, -0)) {
      throw new SerializationError(
        `ddsketch: zeroCount must be finite and not negative, got ${show(zeroCount)}`,
      );
    }
    const sum = view.getFloat64(32, true);
    // No sketch sums to -0: add records -0 as 0, and x + -x is +0. A NaN sum
    // is written as one bit pattern, so any other is a second encoding.
    if (
      Object.is(sum, -0) ||
      (Number.isNaN(sum) &&
        (view.getUint32(32, true) !== 0 ||
          view.getUint32(36, true) !== 0x7ff80000))
    ) {
      throw new SerializationError(
        "ddsketch: sum is -0 or a NaN no writer produces",
      );
    }
    const min = view.getFloat64(40, true);
    const max = view.getFloat64(48, true);
    const count = zeroCount + pos.total + neg.total;
    if (!summariesHold(mapping, pos, neg, zeroCount, count, sum, min, max)) {
      throw new SerializationError(
        "ddsketch: sum, min and max do not agree with the bins",
      );
    }

    const sketch = new DDSketch(relativeAccuracy, {
      mapping: () => mapping,
      store: storeOf(storeKind, maxBins),
    });
    pos.indices.forEach((index, i) => {
      sketch.#positive.add(index, pos.counts[i] ?? 0);
    });
    neg.indices.forEach((index, i) => {
      sketch.#negative.add(index, neg.counts[i] ?? 0);
    });
    sketch.#zeroCount = zeroCount;
    sketch.#count = count;
    sketch.#sum = sum;
    if (count > 0) {
      sketch.#min = min;
      sketch.#max = max;
    }
    return sketch;
  }

  /** See {@link DDSketch.create}. */
  constructor(relativeAccuracy: number, options: DDSketchOptions = {}) {
    const { mapping = bitwiseMapping, store = collapsingLowestStore(4096) } =
      options;
    this.#mapping = mapping(relativeAccuracy);
    this.#minIndexable = this.#mapping.minIndexableValue;
    this.#maxIndexable = this.#mapping.maxIndexableValue;
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

  /**
   * The sum of every value added. Past the largest double it is `Infinity`
   * or `-Infinity`, and NaN once both signs have overflowed.
   */
  get sum(): number {
    return this.#sum;
  }

  /** The smallest value added, exactly; `NaN` when empty. */
  get min(): number {
    return this.#count === 0 ? Number.NaN : this.#min;
  }

  /** The largest value added, exactly; `NaN` when empty. */
  get max(): number {
    return this.#count === 0 ? Number.NaN : this.#max;
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

  // Adds another sketch's bins and summaries into this one. Store.merge
  // leaves the bins adding them one by one would, so a collapsing store folds
  // the merged range exactly as it would have folded one stream.
  #absorb(from: DDSketch): void {
    if (from.#count === 0) return;
    this.#positive.merge(from.#positive);
    this.#negative.merge(from.#negative);
    this.#zeroCount += from.#zeroCount;
    this.#count += from.#count;
    this.#sum += from.#sum;
    this.#widen(from.#min, from.#max);
  }

  // Adds each bin's count at its index, and its value to the summaries as add
  // would. The store is widened to both ends first, so it grows once rather
  // than once per new bin.
  #place(store: Store, bins: Map<number, number>, sign: 1 | -1): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (const index of bins.keys()) {
      if (index < lo) lo = index;
      if (index > hi) hi = index;
    }
    if (lo > hi) return;
    store.add(lo, 0);
    store.add(hi, 0);
    for (const [index, count] of bins) {
      store.add(index, count);
      const value = sign * this.#mapping.value(index);
      this.#count += count;
      this.#sum += value * count;
      if (value < this.#min) this.#min = value;
      if (value > this.#max) this.#max = value;
    }
  }

  // Extends min and max to cover [lo, hi]. NaN compares false, so an empty
  // sketch takes the first range it is given.
  #widen(lo: number, hi: number): void {
    if (lo < this.#min) this.#min = lo;
    if (hi > this.#max) this.#max = hi;
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
    const posLayout = layoutOf(pos.indices, pos.counts);
    const negLayout = layoutOf(neg.indices, neg.counts);
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: NO_HASH },
      PARAMS_SIZE,
      posLayout.size + negLayout.size,
      (_, view) => {
        view.setUint8(0, MAPPING_CODES.indexOf(this.#mapping.kind));
        view.setUint8(1, STORE_CODES.indexOf(this.#store.kind));
        view.setUint32(4, this.#store.maxBins, true);
        view.setFloat64(8, this.#mapping.gamma, true);
        view.setFloat64(16, this.#mapping.indexOffset, true);
        view.setFloat64(24, this.#relativeAccuracy, true);
        // x86 makes Infinity - Infinity a negative NaN; the frame keeps one.
        view.setFloat64(32, Number.isNaN(this.#sum) ? NaN : this.#sum, true);
        view.setFloat64(40, this.min, true);
        view.setFloat64(48, this.max, true);
        view.setFloat64(56, this.#zeroCount, true);
        writeBlock(view, PARAMS_SIZE, posLayout, pos);
        writeBlock(view, PARAMS_SIZE + posLayout.size, negLayout, neg);
      },
    );
  }

  /**
   * Tests structural equality: `true` when `other` serializes to identical
   * bytes, meaning the same mapping, store, summaries and bins.
   *
   * @param other - The sketch to compare against.
   * @returns `true` if the two sketches are byte-for-byte identical.
   */
  equals(other: DDSketch): boolean {
    return bytesEqual(this.toBytes(), other.toBytes());
  }

  /**
   * Serializes the sketch into the JSON envelope: the base64 of
   * {@link DDSketch.toBytes}.
   *
   * @returns The envelope, readable by {@link DDSketch.fromJSON}.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }

  /**
   * Restores a sketch from its {@link DDSketch.toJSON} envelope.
   *
   * @param value - The parsed envelope.
   * @returns The reconstructed sketch.
   * @throws {@link SerializationError} when the envelope or frame is malformed.
   */
  static fromJSON(value: unknown): DDSketch {
    return DDSketch.fromBytes(fromJSONEnvelope(value));
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
    // bin, then the positives. The rank is floored, where sketches-go keeps
    // it fractional. The negatives are walked from the far end, the largest
    // magnitude, so the running total accumulates in value order:
    // sketches-go indexes them as total - 1 - rank from the near end, which
    // is right only for whole weights and rounds a fractional rank up a value.
    const rank = Math.floor(q * (this.#count - 1));
    const negatives = this.#negative.total;
    let value: number;
    if (rank < negatives) {
      value = -this.#mapping.value(this.#negative.keyAtRank(rank, true));
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
    if (count !== 1) assertPositiveFinite(count, "count");
    // The sign picks the store; one range check then covers both, and NaN,
    // which compares false both ways, falls to the zero branch and is refused
    // there. Nothing is recorded before a throw.
    const min = this.#minIndexable;
    const store =
      value > min ? this.#positive : value < -min ? this.#negative : undefined;
    if (store === undefined) {
      value = this.#addZero(value, count);
    } else {
      const magnitude = Math.abs(value);
      if (!(magnitude <= this.#maxIndexable)) throw this.#unindexable(value);
      store.add(this.#mapping.index(magnitude), count);
    }
    this.#count += count;
    this.#sum += value * count;
    if (value < this.#min) this.#min = value;
    if (value > this.#max) this.#max = value;
  }

  // The zero branch, out of line since it is rare: values too small to index,
  // zero itself, and NaN, which compares false both ways and lands here.
  // Returns the value add should record, -0 made +0: without that, [0, -0]
  // and [-0, 0] would leave different min bits and serialize differently.
  #addZero(value: number, count: number): number {
    if (Number.isNaN(value)) throw this.#unindexable(value);
    this.#zeroCount += count;
    return value === 0 ? 0 : value;
  }

  #unindexable(value: number): ParamError {
    return new ParamError(
      `value must be finite and at most ${String(this.#maxIndexable)} in magnitude, got ${String(value)}`,
    );
  }
}
