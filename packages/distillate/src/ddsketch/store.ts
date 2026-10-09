// Bins grown in both directions so a stream drifting up or down reallocates
// rarely rather than per new index.
const HEADROOM = 32;

/** Counts per bin index, over a contiguous window that grows to fit. */
export class DenseStore {
  #bins = new Float64Array(0);
  // The bin index that #bins[0] holds.
  #offset = 0;

  /** Adds `count` to the bin at `index`. */
  add(index: number, count: number): void {
    if (index < this.#offset || index >= this.#offset + this.#bins.length) {
      this.#grow(index);
    }
    const at = index - this.#offset;
    this.#bins[at] = (this.#bins[at] ?? 0) + count;
  }

  /**
   * The index of the bin holding the value at `rank`, counting from 0 in
   * ascending index order: the first bin whose running total exceeds `rank`.
   */
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
