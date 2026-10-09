import { assertPositiveInt } from "../core/params.js";

/** How a store lays out its bins and what it gives up to bound memory. */
export type StoreKind =
  "dense" | "sparse" | "collapsingLowest" | "collapsingHighest";

/** Counts per bin index for one sign of a sketch. */
export interface Store {
  /** The sum of every count added. */
  readonly total: number;
  /** Adds `count` to the bin at `index`. */
  add(index: number, count: number): void;
  /**
   * The index of the bin holding the value at `rank`, counting from 0 in
   * ascending index order.
   */
  keyAtRank(rank: number): number;
  /** Calls `fn` for every non-empty bin, in ascending index order. */
  forEach(fn: (index: number, count: number) => void): void;
}

/**
 * Builds the stores a sketch keeps, one per sign, both with the same policy.
 * Passed to {@link DDSketch.create} as `store`.
 */
export interface StoreFactory {
  /** Which store this builds. */
  readonly kind: StoreKind;
  /** The most bins a store keeps, or 0 when unbounded. */
  readonly maxBins: number;
  /** A new, empty store. */
  create(): Store;
}

// Bins grown in both directions so a stream drifting up or down reallocates
// rarely rather than per new index.
const HEADROOM = 32;

// Which end of the range a bounded store folds into its outermost kept bin.
type Collapse = "lowest" | "highest" | null;

/** Counts per bin index, over a contiguous window that grows to fit. */
class DenseStore implements Store {
  readonly #maxBins: number;
  readonly #collapse: Collapse;
  #bins = new Float64Array(0);
  // The bin index that #bins[0] holds.
  #offset = 0;
  // The lowest and highest non-empty bin indices. Infinite while empty, so the
  // range test in add needs no separate check for an empty store.
  #min = Infinity;
  #max = -Infinity;
  #total = 0;

  constructor(maxBins = 0, collapse: Collapse = null) {
    this.#maxBins = maxBins;
    this.#collapse = collapse;
  }

  get total(): number {
    return this.#total;
  }

  add(index: number, count: number): void {
    // Most adds land inside the range already held: no bound moves, nothing
    // grows or folds, so the bin is incremented and nothing else is touched.
    if (index >= this.#min && index <= this.#max) {
      const at = index - this.#offset;
      this.#bins[at] = (this.#bins[at] ?? 0) + count;
      this.#total += count;
      return;
    }
    let min = Math.min(this.#min, index);
    let max = Math.max(this.#max, index);
    const collapses = this.#collapse !== null && max - min + 1 > this.#maxBins;
    if (collapses) {
      // Clamp the new index into the kept range; the bins it pushes out are
      // folded below, once the window covers the kept range.
      if (this.#collapse === "lowest") {
        min = max - this.#maxBins + 1;
        index = Math.max(index, min);
      } else {
        max = min + this.#maxBins - 1;
        index = Math.min(index, max);
      }
    }
    if (min < this.#offset || max >= this.#offset + this.#bins.length) {
      this.#grow(min, max);
    }
    if (collapses) this.#fold(min, max);
    const at = index - this.#offset;
    this.#bins[at] = (this.#bins[at] ?? 0) + count;
    this.#min = min;
    this.#max = max;
    this.#total += count;
  }

  // The first bin whose running total exceeds rank.
  keyAtRank(rank: number): number {
    let running = 0;
    let last = this.#min;
    for (let index = this.#min; index <= this.#max; index++) {
      const count = this.#bins[index - this.#offset] ?? 0;
      if (count === 0) continue;
      running += count;
      last = index;
      if (running > rank) break;
    }
    return last;
  }

  forEach(fn: (index: number, count: number) => void): void {
    if (this.#total === 0) return;
    for (let index = this.#min; index <= this.#max; index++) {
      const count = this.#bins[index - this.#offset] ?? 0;
      if (count !== 0) fn(index, count);
    }
  }

  // Moves every count outside [min, max] into the nearer end bin.
  #fold(min: number, max: number): void {
    let below = 0;
    for (let index = this.#min; index < min; index++) {
      const at = index - this.#offset;
      below += this.#bins[at] ?? 0;
      this.#bins[at] = 0;
    }
    let above = 0;
    for (let index = max + 1; index <= this.#max; index++) {
      const at = index - this.#offset;
      above += this.#bins[at] ?? 0;
      this.#bins[at] = 0;
    }
    const lo = min - this.#offset;
    const hi = max - this.#offset;
    this.#bins[lo] = (this.#bins[lo] ?? 0) + below;
    this.#bins[hi] = (this.#bins[hi] ?? 0) + above;
  }

  // Reallocates around [min, max] plus the bins currently held, so nothing is
  // lost before #fold runs.
  #grow(min: number, max: number): void {
    const empty = this.#total === 0;
    const lo = empty ? min : Math.min(min, this.#min);
    const hi = empty ? max : Math.max(max, this.#max);
    const span = hi - lo + 1;
    const bins = new Float64Array(span + 2 * (HEADROOM + (span >>> 1)));
    const offset = lo - HEADROOM - (span >>> 1);
    if (!empty) {
      bins.set(
        this.#bins.subarray(
          this.#min - this.#offset,
          this.#max - this.#offset + 1,
        ),
        this.#min - offset,
      );
    }
    this.#bins = bins;
    this.#offset = offset;
  }
}

/**
 * Bins over one contiguous range of indices that grows to fit, with no bound
 * on memory: a stream spanning a wide range of magnitudes keeps every bin.
 */
export function denseStore(): StoreFactory {
  return { kind: "dense", maxBins: 0, create: () => new DenseStore() };
}

class SparseStore implements Store {
  readonly #bins = new Map<number, number>();
  // Bin indices in ascending order, rebuilt only after a new index arrives.
  #sorted: number[] | null = [];
  #total = 0;

  get total(): number {
    return this.#total;
  }

  add(index: number, count: number): void {
    const held = this.#bins.get(index);
    if (held === undefined) this.#sorted = null;
    this.#bins.set(index, (held ?? 0) + count);
    this.#total += count;
  }

  keyAtRank(rank: number): number {
    let running = 0;
    let last = 0;
    for (const index of this.#keys()) {
      running += this.#bins.get(index) ?? 0;
      last = index;
      if (running > rank) break;
    }
    return last;
  }

  forEach(fn: (index: number, count: number) => void): void {
    for (const index of this.#keys()) fn(index, this.#bins.get(index) ?? 0);
  }

  #keys(): number[] {
    this.#sorted ??= [...this.#bins.keys()].sort((a, b) => a - b);
    return this.#sorted;
  }
}

/**
 * Bins only where values landed, so memory follows the number of distinct
 * bins rather than the range between the smallest and largest.
 */
export function sparseStore(): StoreFactory {
  return { kind: "sparse", maxBins: 0, create: () => new SparseStore() };
}

/**
 * A dense store that never spans more than `maxBins` bins. Past that it folds
 * the lowest bins into the lowest one it keeps, giving up accuracy on the
 * smallest magnitudes, near zero on either sign, and keeping it for the
 * largest. The default, since the tails are what quantiles are read for.
 *
 * @param maxBins - The most bins kept per sign; a positive integer.
 * @throws {@link ParamError} when `maxBins` is not a positive integer.
 */
export function collapsingLowestStore(maxBins: number): StoreFactory {
  assertPositiveInt(maxBins, "maxBins");
  return {
    kind: "collapsingLowest",
    maxBins,
    create: () => new DenseStore(maxBins, "lowest"),
  };
}

/**
 * A dense store that never spans more than `maxBins` bins. Past that it folds
 * the highest bins into the highest one it keeps, giving up accuracy on the
 * largest magnitudes and keeping it for the smallest.
 *
 * @param maxBins - The most bins kept per sign; a positive integer.
 * @throws {@link ParamError} when `maxBins` is not a positive integer.
 */
export function collapsingHighestStore(maxBins: number): StoreFactory {
  assertPositiveInt(maxBins, "maxBins");
  return {
    kind: "collapsingHighest",
    maxBins,
    create: () => new DenseStore(maxBins, "highest"),
  };
}
