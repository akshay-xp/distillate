import type { BytesLike } from "../core/bytes.js";
import { hash128KeyInto, type Hash128 } from "../core/hasher.js";
import { assertUint32, ParamError } from "../core/params.js";
import { HLL_MAX_P, HLL_MIN_P, hllSizing } from "../core/sizing.js";
import { estimate } from "./estimate.js";
import { foldDense } from "./fold.js";
import { Registers } from "./registers.js";
import {
  compact,
  encodeSparse,
  foldSparse,
  refoldSparse,
  SPARSE_P,
  sparseIndex,
  sparseRho,
} from "./sparse.js";

// Relative standard error of a HyperLogLog with 2**p registers, from the
// original Flajolet analysis. Reported, never used to correct an estimate.
const ERROR_CONSTANT = 1.04;

function assertPrecision(p: number): void {
  if (!Number.isInteger(p) || p < HLL_MIN_P || p > HLL_MAX_P) {
    throw new ParamError(
      `p must be an integer in [${String(HLL_MIN_P)}, ${String(HLL_MAX_P)}], got ${String(p)}`,
    );
  }
}

/** Construction parameters for a {@link HyperLogLog} sketch. */
export interface HllParams {
  /** Precision: the sketch holds `2 ** p` registers. */
  p: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A HyperLogLog sketch: estimates how many distinct keys it has seen, in space
 * fixed by `p` rather than by the cardinality.
 *
 * @example
 * ```ts
 * const sketch = HyperLogLog.create(0.01);
 * sketch.add("alice");
 * ```
 */
export class HyperLogLog {
  readonly #registers: Registers;
  readonly #p: number;
  readonly #seed: number;
  // Reused across add() so hashing a key allocates nothing per call.
  readonly #scratch: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };
  // Entries seen so far, or null once the sketch has gone dense.
  #sparse: Int32Array | null;
  // How much of #sparse is in use.
  #len = 0;

  /**
   * Creates a sketch at an explicit precision.
   *
   * @param params - Precision and optional hash seed.
   */
  constructor({ p, seed = 0 }: HllParams) {
    assertPrecision(p);
    assertUint32(seed, "seed");
    this.#registers = new Registers(p);
    this.#p = p;
    this.#seed = seed;
    // The sparse buffer is allowed exactly the memory the dense registers
    // already occupy, four bytes to the entry, so a sketch never costs more
    // than its dense form no matter which representation it is in.
    this.#sparse = new Int32Array(this.#registers.bytes.length >> 2);
  }

  /**
   * Creates a sketch whose standard error meets `relativeError`.
   *
   * @param relativeError - Target relative error, e.g. `0.01` for 1%.
   * @returns A new, empty sketch.
   */
  static create(relativeError: number): HyperLogLog {
    return new HyperLogLog(hllSizing(relativeError));
  }

  /** Precision: the sketch holds `2 ** p` registers. */
  get p(): number {
    return this.#p;
  }

  /** Hash seed the sketch was built with. */
  get seed(): number {
    return this.#seed;
  }

  /** Analytic relative standard error, `1.04 / sqrt(2 ** p)`. */
  get standardError(): number {
    return ERROR_CONSTANT / Math.sqrt(2 ** this.#p);
  }

  /**
   * Records a key. Adding a key already seen leaves the sketch unchanged, which
   * is what lets it count distinct values without storing them.
   *
   * @param key - The key to record.
   */
  add(key: BytesLike): void {
    const s = this.#scratch;
    hash128KeyInto(key, this.#seed, s);

    // Top p bits pick the register; the remaining 64 - p bits of the (w0, w1)
    // lane give rho, the position of the first set bit counted from 1.
    const p = this.#p;
    const tail = (s.w0 << p) >>> 0;
    const rho =
      tail !== 0 ? Math.clz32(tail) + 1 : 32 - p + Math.clz32(s.w1) + 1;

    const sparse = this.#sparse;
    if (sparse === null) {
      this.#registers.raise(s.w0 >>> (32 - p), rho);
      return;
    }

    sparse[this.#len++] = encodeSparse(s.w0 >>> (32 - SPARSE_P), rho);
    if (this.#len === sparse.length) this.#collapse(sparse);
  }

  // Squeezes duplicates out of a full sparse buffer, and goes dense if that did
  // not win back enough room to be worth doing again.
  #collapse(sparse: Int32Array): void {
    const distinct = compact(sparse, this.#len);
    this.#len = distinct;

    const slack = Math.max(1, sparse.length >> 2);
    if (distinct > sparse.length - slack) this.#goDense();
  }

  /**
   * Merges two sketches, giving a sketch that counts the keys either has seen.
   *
   * Both operands are left untouched.
   *
   * @param other - The sketch to merge with; must share this one's seed.
   * @returns A new sketch holding both key sets.
   * @throws {@link ParamError} if the seeds differ, since the two would have
   * sent the same key to different registers and the merge would mean nothing.
   */
  union(other: HyperLogLog): HyperLogLog {
    if (other.#seed !== this.#seed) {
      throw new ParamError(
        `cannot merge sketches with different seeds, got ${String(this.#seed)} and ${String(other.#seed)}`,
      );
    }

    // The coarser precision wins: a finer sketch folds down cleanly, while the
    // reverse would invent detail it never recorded.
    const p = Math.min(this.#p, other.#p);
    const merged = new HyperLogLog({ p, seed: this.#seed });
    merged.#drain(this);
    merged.#drain(other);
    return merged;
  }

  // Folds everything `src` holds into this sketch, whichever representation
  // either of them is in.
  #drain(src: HyperLogLog): void {
    const sparse = src.#sparse;
    if (sparse === null) {
      this.#goDense();
      foldDense(src.#registers, src.#p, this.#registers, this.#p);
      return;
    }

    const distinct = compact(sparse, src.#len);
    src.#len = distinct;
    for (let i = 0; i < distinct; i++) {
      this.#absorb(refoldSparse(sparse[i] ?? 0, src.#p, this.#p));
    }
  }

  // Takes one sparse entry, already expressed at this sketch's precision.
  #absorb(entry: number): void {
    const sparse = this.#sparse;
    if (sparse === null) {
      const index = sparseIndex(entry) >>> (SPARSE_P - this.#p);
      this.#registers.raise(index, sparseRho(entry));
      return;
    }

    sparse[this.#len++] = entry;
    if (this.#len === sparse.length) this.#collapse(sparse);
  }

  // Gives up the sparse buffer, keeping what it held.
  #goDense(): void {
    const sparse = this.#sparse;
    if (sparse === null) return;

    foldSparse(sparse, this.#len, this.#p, this.#registers, this.#p);
    this.#sparse = null;
    this.#len = 0;
  }

  // The registers this sketch stands for, materialising them if it is still
  // sparse. Sparse and dense are two spellings of the same set of registers,
  // so this is what lets them be compared.
  #dense(): Registers {
    const sparse = this.#sparse;
    if (sparse === null) return this.#registers;

    const out = new Registers(this.#p);
    foldSparse(sparse, this.#len, this.#p, out, this.#p);
    return out;
  }

  /**
   * Whether two sketches hold the same registers at the same precision and
   * seed. Which representation each is in does not enter into it.
   *
   * @param other - The sketch to compare against.
   * @returns `true` if the two would answer every query identically.
   */
  equals(other: HyperLogLog): boolean {
    if (other.#p !== this.#p || other.#seed !== this.#seed) return false;

    const mine = this.#dense().bytes;
    const theirs = other.#dense().bytes;
    for (let i = 0; i < mine.length; i++) {
      if (mine[i] !== theirs[i]) return false;
    }
    return true;
  }

  /**
   * Counts how many distinct keys have been added. Small sketches answer
   * exactly; larger ones estimate, within {@link standardError}.
   *
   * @returns The cardinality, a whole number; `0` for an empty sketch.
   */
  count(): number {
    const sparse = this.#sparse;
    if (sparse !== null) {
      // Every distinct key still has its own sparse index, so this counts
      // rather than estimates: linear counting over 2 ** SPARSE_P buckets is
      // off by under half a key for any cardinality a sparse sketch can hold.
      const distinct = compact(sparse, this.#len);
      this.#len = distinct;
      const buckets = 2 ** SPARSE_P;
      return Math.round(buckets * Math.log(buckets / (buckets - distinct)));
    }

    const p = this.#p;
    const q = 64 - p;
    const m = 2 ** p;
    const hist = new Int32Array(q + 2);
    for (let i = 0; i < m; i++) {
      const value = this.#registers.get(i);
      hist[value] = (hist[value] ?? 0) + 1;
    }
    return Math.round(estimate(hist, p));
  }
}
