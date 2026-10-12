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
   * ascending index order, or descending when `descending` is set.
   */
  keyAtRank(rank: number, descending?: boolean): number;
  /** Calls `fn` for every non-empty bin, in ascending index order. */
  forEach(fn: (index: number, count: number) => void): void;
  /** Adds every bin of `other`, as adding them in ascending index order would. */
  merge(other: Store): void;
}

/**
 * Builds the stores a sketch keeps, one per sign, both with the same policy.
 * Passed to {@link DDSketch.create} as `store`. Built by this module's
 * factories only: a sketch serializes its store by `kind` and `maxBins`, so a
 * custom one would be read back as the built-in store of that kind.
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
    // The rest is out of line so this stays small enough for V8 to inline.
    if (index >= this.#min && index <= this.#max) {
      const at = index - this.#offset;
      this.#bins[at] = (this.#bins[at] ?? 0) + count;
      this.#total += count;
      return;
    }
    this.#extend(index, count);
  }

  // An add outside the held range: widen it, growing the array or folding
  // the far end into the kept range when the store is bounded.
  #extend(index: number, count: number): void {
    let min = Math.min(this.#min, index);
    let max = Math.max(this.#max, index);
    let below = 0;
    let above = 0;
    if (this.#collapse !== null && max - min + 1 > this.#maxBins) {
      // Clamp the new index into the kept range, and take the counts it
      // pushes out from the old array before anything is reallocated, so the
      // array never has to span the bins being given up.
      if (this.#collapse === "lowest") {
        min = max - this.#maxBins + 1;
        index = Math.max(index, min);
      } else {
        max = min + this.#maxBins - 1;
        index = Math.min(index, max);
      }
      below = this.#take(this.#min, Math.min(this.#max, min - 1));
      above = this.#take(Math.max(this.#min, max + 1), this.#max);
    }
    if (min < this.#offset || max >= this.#offset + this.#bins.length) {
      this.#grow(min, max);
    }
    const lo = min - this.#offset;
    const hi = max - this.#offset;
    this.#bins[lo] = (this.#bins[lo] ?? 0) + below;
    this.#bins[hi] = (this.#bins[hi] ?? 0) + above;
    const at = index - this.#offset;
    this.#bins[at] = (this.#bins[at] ?? 0) + count;
    this.#min = min;
    this.#max = max;
    this.#total += count;
  }

  // The first bin whose running total exceeds rank. One loop per direction:
  // a step chosen per bin costs about 40% of the scan. Empty bins need no
  // skip: they leave the total where it was, so it crosses rank only on a
  // non-empty bin, and both ends of the held range are non-empty.
  keyAtRank(rank: number, descending = false): number {
    const bins = this.#bins;
    const min = this.#min - this.#offset;
    const max = this.#max - this.#offset;
    let running = 0;
    if (descending) {
      let at = max;
      while (at > min) {
        running += bins[at] ?? 0;
        if (running > rank) break;
        at--;
      }
      return at + this.#offset;
    }
    let at = min;
    while (at < max) {
      running += bins[at] ?? 0;
      if (running > rank) break;
      at++;
    }
    return at + this.#offset;
  }

  merge(other: Store): void {
    if (!(other instanceof DenseStore)) {
      other.forEach((index, count) => {
        this.add(index, count);
      });
      return;
    }
    if (other.#total === 0) return;
    // Widening to both ends first sets the window an ascending replay would
    // end on; every bin then lands in it, a folded one at the nearer end.
    this.add(other.#min, 0);
    this.add(other.#max, 0);
    const from = other.#bins;
    const to = this.#bins;
    const lo = this.#min;
    const hi = this.#max;
    for (let index = other.#min; index <= other.#max; index++) {
      const count = from[index - other.#offset] ?? 0;
      if (count === 0) continue;
      const at = Math.min(Math.max(index, lo), hi) - this.#offset;
      to[at] = (to[at] ?? 0) + count;
      this.#total += count;
    }
  }

  forEach(fn: (index: number, count: number) => void): void {
    if (this.#total === 0) return;
    for (let index = this.#min; index <= this.#max; index++) {
      const count = this.#bins[index - this.#offset] ?? 0;
      if (count !== 0) fn(index, count);
    }
  }

  // Empties the held bins from lo to hi and returns what they held.
  #take(lo: number, hi: number): number {
    let taken = 0;
    for (let index = lo; index <= hi; index++) {
      const at = index - this.#offset;
      taken += this.#bins[at] ?? 0;
      this.#bins[at] = 0;
    }
    return taken;
  }

  // Reallocates around [min, max], keeping the held bins inside it. A bounded
  // store's array never outgrows maxBins plus its headroom.
  #grow(min: number, max: number): void {
    const span = max - min + 1;
    let length = span + 2 * (HEADROOM + (span >>> 1));
    if (this.#collapse !== null) {
      length = Math.min(length, this.#maxBins + 2 * HEADROOM);
    }
    const bins = new Float64Array(length);
    const offset = min - ((length - span) >>> 1);
    const lo = Math.max(min, this.#min);
    const hi = Math.min(max, this.#max);
    if (lo <= hi) {
      bins.set(
        this.#bins.subarray(lo - this.#offset, hi - this.#offset + 1),
        lo - offset,
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

  keyAtRank(rank: number, descending = false): number {
    let running = 0;
    let last = 0;
    const keys = this.#keys();
    for (let i = 0; i < keys.length; i++) {
      const index = keys[descending ? keys.length - 1 - i : i] ?? 0;
      running += this.#bins.get(index) ?? 0;
      last = index;
      if (running > rank) break;
    }
    return last;
  }

  forEach(fn: (index: number, count: number) => void): void {
    for (const index of this.#keys()) fn(index, this.#bins.get(index) ?? 0);
  }

  merge(other: Store): void {
    other.forEach((index, count) => {
      this.add(index, count);
    });
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
