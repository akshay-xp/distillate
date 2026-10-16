import { R64 } from "../core/hasher.js";
import { checksumOf, nextIndex } from "./mapping.js";

/**
 * Symbols with their checksums and index sequences, ordered by the next index
 * each reaches. Struct-of-arrays in typed arrays grown by doubling, so folding
 * a window into a coded symbol allocates nothing.
 */
export class CodingWindow {
  #lo = new Uint32Array(16);
  #hi = new Uint32Array(16);
  #checkLo = new Uint32Array(16);
  #checkHi = new Uint32Array(16);
  #state = new Uint32Array(16);
  // Float64: a gap can carry an index past 2^32, where it never comes round.
  #next = new Float64Array(16);
  // Min-heap of entries on #next.
  #heap = new Int32Array(16);
  #size = 0;

  /** Adds a symbol whose index sequence is advanced to the first index at or past `from`. */
  add(lo: number, hi: number, from: number): void {
    if (this.#size === this.#lo.length) this.#grow();
    const at = this.#size++;
    this.#lo[at] = lo;
    this.#hi[at] = hi;
    checksumOf(lo, hi);
    this.#checkLo[at] = R64[0] ?? 0;
    this.#checkHi[at] = R64[1] ?? 0;
    this.#state[at] = R64[0] ?? 0;
    let index = 0;
    while (index < from) index = nextIndex(this.#state, at, index);
    this.#next[at] = index;
    this.#siftUp(at);
  }

  /**
   * Folds every symbol mapped to `index` into the coded symbol at `cells[at]`
   * (sum lo, sum hi, checksum lo, checksum hi, count) and adds `sign` to the
   * count per symbol. Indices must be applied in increasing order.
   */
  applyTo(cells: Uint32Array, at: number, index: number, sign: number): void {
    const heap = this.#heap;
    while (this.#size > 0) {
      const top = heap[0] ?? 0;
      if (this.#next[top] !== index) return;
      cells[at] = (cells[at] ?? 0) ^ (this.#lo[top] ?? 0);
      cells[at + 1] = (cells[at + 1] ?? 0) ^ (this.#hi[top] ?? 0);
      cells[at + 2] = (cells[at + 2] ?? 0) ^ (this.#checkLo[top] ?? 0);
      cells[at + 3] = (cells[at + 3] ?? 0) ^ (this.#checkHi[top] ?? 0);
      cells[at + 4] = (cells[at + 4] ?? 0) + sign;
      this.#next[top] = nextIndex(this.#state, top, index);
      this.#siftDown();
    }
  }

  /** Calls `fn` with each symbol's lanes, in insertion order. */
  forEach(fn: (lo: number, hi: number) => void): void {
    for (let i = 0; i < this.#size; i++) fn(this.#lo[i] ?? 0, this.#hi[i] ?? 0);
  }

  #grow(): void {
    const size = this.#lo.length * 2;
    const grow = <T extends Uint32Array | Float64Array | Int32Array>(
      from: T,
      to: T,
    ): T => {
      to.set(from);
      return to;
    };
    this.#lo = grow(this.#lo, new Uint32Array(size));
    this.#hi = grow(this.#hi, new Uint32Array(size));
    this.#checkLo = grow(this.#checkLo, new Uint32Array(size));
    this.#checkHi = grow(this.#checkHi, new Uint32Array(size));
    this.#state = grow(this.#state, new Uint32Array(size));
    this.#next = grow(this.#next, new Float64Array(size));
    this.#heap = grow(this.#heap, new Int32Array(size));
  }

  #siftUp(entry: number): void {
    const heap = this.#heap;
    const next = this.#next;
    const key = next[entry] ?? 0;
    let at = this.#size - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      const above = heap[parent] ?? 0;
      if ((next[above] ?? 0) <= key) break;
      heap[at] = above;
      at = parent;
    }
    heap[at] = entry;
  }

  // Re-seats the root after its index advanced.
  #siftDown(): void {
    const heap = this.#heap;
    const next = this.#next;
    const size = this.#size;
    const entry = heap[0] ?? 0;
    const key = next[entry] ?? 0;
    let at = 0;
    for (;;) {
      let child = 2 * at + 1;
      if (child >= size) break;
      const right = child + 1;
      if (
        right < size &&
        (next[heap[right] ?? 0] ?? 0) < (next[heap[child] ?? 0] ?? 0)
      ) {
        child = right;
      }
      const below = heap[child] ?? 0;
      if ((next[below] ?? 0) >= key) break;
      heap[at] = below;
      at = child;
    }
    heap[at] = entry;
  }
}
