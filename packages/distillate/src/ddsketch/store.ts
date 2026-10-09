/** How a store lays out its bins and what it gives up to bound memory. */
export type StoreKind = "dense";

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

/** Counts per bin index, over a contiguous window that grows to fit. */
class DenseStore implements Store {
  #bins = new Float64Array(0);
  // The bin index that #bins[0] holds.
  #offset = 0;
  #total = 0;

  /** The sum of every count added. */
  get total(): number {
    return this.#total;
  }

  /** Adds `count` to the bin at `index`. */
  add(index: number, count: number): void {
    if (index < this.#offset || index >= this.#offset + this.#bins.length) {
      this.#grow(index);
    }
    const at = index - this.#offset;
    this.#bins[at] = (this.#bins[at] ?? 0) + count;
    this.#total += count;
  }

  // The first bin whose running total exceeds rank.
  keyAtRank(rank: number): number {
    let running = 0;
    let last = this.#offset;
    for (let i = 0; i < this.#bins.length; i++) {
      const count = this.#bins[i] ?? 0;
      if (count === 0) continue;
      running += count;
      last = i + this.#offset;
      if (running > rank) break;
    }
    return last;
  }

  forEach(fn: (index: number, count: number) => void): void {
    for (let i = 0; i < this.#bins.length; i++) {
      const count = this.#bins[i] ?? 0;
      if (count !== 0) fn(i + this.#offset, count);
    }
  }

  #grow(index: number): void {
    const old = this.#bins;
    const empty = old.length === 0;
    const lo = empty ? index : Math.min(index, this.#offset);
    const hi = empty ? index : Math.max(index, this.#offset + old.length - 1);
    const span = hi - lo + 1;
    const bins = new Float64Array(span + 2 * (HEADROOM + (span >>> 1)));
    const offset = lo - HEADROOM - (span >>> 1);
    if (!empty) bins.set(old, this.#offset - offset);
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
