import { R64 } from "../core/hasher.js";
import { ParamError } from "../core/params.js";
import { checksum, nextIndex } from "./mapping.js";

/**
 * Symbols with their checksums and index sequences, filed in a bucket per next
 * index. Indices are applied in increasing order, each once, so the bucket for
 * the current index holds exactly the symbols due there: O(1) per update where
 * a heap paid O(log n). Struct-of-arrays in typed arrays grown by doubling, so
 * folding a window into a coded symbol allocates nothing.
 */
export class CodingWindow {
  #lo = new Uint32Array(16);
  #hi = new Uint32Array(16);
  #checkLo = new Uint32Array(16);
  #checkHi = new Uint32Array(16);
  // Two lanes per symbol: its PRNG, seeded with its checksum.
  #state = new Uint32Array(32);
  // Float64: a gap can carry an index past 2^32, where it never comes round.
  #next = new Float64Array(16);
  // Next entry in the same bucket, or -1.
  #link = new Int32Array(16);
  // First entry of each bucket below #head.length, or -1, by absolute index.
  // Grows 4 B per symbol streamed; a ring would not bound it, since the gap to
  // a symbol's next index grows with the index.
  #head = new Int32Array(64).fill(-1);
  // Entries due at or past #head.length, filed when the buckets reach them.
  #far = new Int32Array(16);
  #farSize = 0;
  #size = 0;

  /**
   * Adds the symbol at `lanes[offset]` (lo, hi), passed as a typed array so
   * its words are never boxed, whose index sequence is advanced to the first
   * index at or past `from`.
   */
  add(lanes: Uint32Array, offset: number, from: number): void {
    if (this.#size === this.#lo.length) this.#grow();
    const at = this.#size++;
    const lo = lanes[offset] ?? 0;
    const hi = lanes[offset + 1] ?? 0;
    this.#lo[at] = lo;
    this.#hi[at] = hi;
    R64[0] = lo;
    R64[1] = hi;
    checksum();
    this.#checkLo[at] = R64[0];
    this.#checkHi[at] = R64[1];
    this.#state[2 * at] = R64[0];
    this.#state[2 * at + 1] = R64[1];
    let index = 0;
    while (index < from) index = nextIndex(this.#state, at, index);
    this.#next[at] = index;
    this.#file(at);
  }

  /**
   * Throws unless every symbol is distinct. Two equal symbols cancel in the
   * sums but add in the count, so their cells never peel and a decode never
   * finishes. Sorts the pairs as one 64-bit word each, so nothing is boxed.
   *
   * @throws {@link ParamError} If two symbols are equal.
   */
  assertDistinct(seed: number): void {
    const size = this.#size;
    const words = new Uint32Array(2 * size);
    for (let i = 0; i < size; i++) {
      words[2 * i] = this.#lo[i] ?? 0;
      words[2 * i + 1] = this.#hi[i] ?? 0;
    }
    new BigUint64Array(words.buffer).sort();
    for (let i = 2; i < 2 * size; i += 2) {
      if (words[i] === words[i - 2] && words[i + 1] === words[i - 1]) {
        throw new ParamError(
          `keys must be distinct: two keys hash alike under seed ${String(seed)}, a repeated key or a 64-bit collision; deduplicate them, or pick another seed`,
        );
      }
    }
  }

  /**
   * Folds every symbol mapped to `index` into the coded symbol at `cells[at]`
   * (sum lo, sum hi, checksum lo, checksum hi, count) and adds `sign` to the
   * count per symbol. Indices must be applied in increasing order, each once.
   */
  applyTo(cells: Uint32Array, at: number, index: number, sign: number): void {
    if (index >= this.#head.length) this.#widen(index);
    const head = this.#head;
    const link = this.#link;
    let entry = head[index] ?? -1;
    head[index] = -1;
    while (entry !== -1) {
      const following = link[entry] ?? -1;
      cells[at] = (cells[at] ?? 0) ^ (this.#lo[entry] ?? 0);
      cells[at + 1] = (cells[at + 1] ?? 0) ^ (this.#hi[entry] ?? 0);
      cells[at + 2] = (cells[at + 2] ?? 0) ^ (this.#checkLo[entry] ?? 0);
      cells[at + 3] = (cells[at + 3] ?? 0) ^ (this.#checkHi[entry] ?? 0);
      cells[at + 4] = (cells[at + 4] ?? 0) + sign;
      this.#next[entry] = nextIndex(this.#state, entry, index);
      this.#file(entry);
      entry = following;
    }
  }

  /** Calls `fn` with each symbol's lanes, in insertion order. */
  forEach(fn: (lo: number, hi: number) => void): void {
    for (let i = 0; i < this.#size; i++) fn(this.#lo[i] ?? 0, this.#hi[i] ?? 0);
  }

  // Puts an entry in the bucket for its next index, or on the far list.
  #file(entry: number): void {
    const next = this.#next[entry] ?? 0;
    const head = this.#head;
    if (next < head.length) {
      this.#link[entry] = head[next] ?? -1;
      head[next] = entry;
      return;
    }
    if (this.#farSize === this.#far.length) {
      const far = new Int32Array(this.#far.length * 2);
      far.set(this.#far);
      this.#far = far;
    }
    this.#far[this.#farSize++] = entry;
  }

  // Doubles the buckets past `index` and files the far entries now in range,
  // compacting the far list in place.
  #widen(index: number): void {
    let length = this.#head.length * 2;
    while (length <= index) length *= 2;
    const head = new Int32Array(length).fill(-1);
    head.set(this.#head);
    this.#head = head;
    const far = this.#far;
    const waiting = this.#farSize;
    this.#farSize = 0;
    for (let i = 0; i < waiting; i++) this.#file(far[i] ?? 0);
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
    this.#state = grow(this.#state, new Uint32Array(2 * size));
    this.#next = grow(this.#next, new Float64Array(size));
    this.#link = grow(this.#link, new Int32Array(size));
  }
}
