import type { Hash128 } from "./hasher.js";

const START = 1024;

/**
 * The distinct hashes of a key stream, compared on their first `width` words
 * and kept in first-seen order, for the `from` builds that must drop repeats.
 *
 * Typed arrays rather than a `Set` of formatted ids: a string per key was most
 * of what a 5M-key Cuckoo build cost, and the stored words let the caller build
 * from the hashes it already has instead of hashing every key again.
 *
 * `width` is how many words decide sameness, so each structure dedupes on
 * exactly what it must: Cuckoo on all four, since keys sharing only the bits
 * it uses must stay two copies; Fuse on two, since that is all it can tell
 * apart and construction fails on a repeat.
 */
export class DistinctHashes {
  readonly #width: 2 | 4;
  #words: Uint32Array;
  // Index + 1 of the tuple in each slot, 0 for empty.
  #table = new Int32Array(2 * START);
  #size = 0;

  constructor(width: 2 | 4) {
    this.#width = width;
    this.#words = new Uint32Array(START * width);
  }

  /** Tuples kept so far. */
  get size(): number {
    return this.#size;
  }

  /** The kept tuples' words, `width` per tuple, in first-seen order. */
  get words(): Uint32Array {
    return this.#words.subarray(0, this.#size * this.#width);
  }

  /**
   * Keeps `hash` unless an equal tuple is already held.
   *
   * @returns `true` if it was new.
   */
  add(hash: Hash128): boolean {
    const width = this.#width;
    const w0 = hash.w0 >>> 0;
    const w1 = hash.w1 >>> 0;
    const w2 = hash.w2 >>> 0;
    const w3 = hash.w3 >>> 0;
    // Grown first, so the empty slot the probe ends on is in the live table.
    if ((this.#size + 1) * width > this.#words.length) this.#grow();
    const words = this.#words;
    const mask = this.#table.length - 1;
    let slot = w0 & mask;
    for (;;) {
      const held = this.#table[slot] ?? 0;
      if (held === 0) break;
      const at = (held - 1) * width;
      if (
        words[at] === w0 &&
        words[at + 1] === w1 &&
        (width === 2 || (words[at + 2] === w2 && words[at + 3] === w3))
      ) {
        return false;
      }
      slot = (slot + 1) & mask;
    }

    const at = this.#size * width;
    words[at] = w0;
    words[at + 1] = w1;
    if (width === 4) {
      words[at + 2] = w2;
      words[at + 3] = w3;
    }
    this.#size++;
    this.#table[slot] = this.#size;
    return true;
  }

  // Doubles both arrays and re-places every tuple, keeping load at 1/2.
  #grow(): void {
    const words = new Uint32Array(this.#words.length * 2);
    words.set(this.#words);
    this.#words = words;
    this.#table = new Int32Array(this.#table.length * 2);
    for (let i = 0; i < this.#size; i++) this.#place(i);
  }

  // Records tuple `i` in the first empty slot of its probe path.
  #place(i: number): void {
    const mask = this.#table.length - 1;
    let slot = (this.#words[i * this.#width] ?? 0) & mask;
    while ((this.#table[slot] ?? 0) !== 0) slot = (slot + 1) & mask;
    this.#table[slot] = i + 1;
  }
}
