import type { BytesLike } from "../core/bytes.js";
import { type Hash128, hash128KeyInto, reduce } from "../core/hasher.js";
import {
  assertPositiveInt,
  assertProbability,
  assertUint32,
} from "../core/params.js";
import { cuckooSizing } from "../core/sizing.js";

/** Slots per bucket. */
const SLOTS = 4;

/** Displacements an add tries before it reports the filter full. */
const MAX_KICKS = 500;

// Reused hash output; safe because add and has are synchronous.
const HASH: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };

/** Thrown when an add cannot find room; the filter is left exactly as it was. */
export class CuckooFullError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "CuckooFullError";
}

/** Settings for a {@link CuckooFilter}. */
export interface CuckooParams {
  /** Expected number of keys. */
  n: number;
  /** Target false-positive rate at `n` keys, e.g. `0.01` for 1%. */
  epsilon: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/** The optional settings {@link CuckooFilter.create} takes after `n` and `epsilon`. */
export type CuckooOptions = Omit<CuckooParams, "n" | "epsilon">;

/**
 * A cuckoo filter: a set with a tunable false-positive rate, zero false
 * negatives, and delete. Keys are stored as short fingerprints in one of two
 * candidate buckets (Fan et al., "Cuckoo Filter: Practically Better Than
 * Bloom", 2014).
 */
export class CuckooFilter {
  readonly #n: number;
  readonly #epsilon: number;
  readonly #seed: number;
  readonly #f: number;
  readonly #buckets: number;
  readonly #mask: number;
  readonly #words: Uint32Array;
  #count = 0;
  // The last key's fingerprint and candidate buckets, set by #hash.
  #fp = 0;
  #i1 = 0;
  #i2 = 0;

  /**
   * Creates a filter sized for `n` expected keys at a target false-positive rate.
   *
   * @param n - Expected number of keys.
   * @param epsilon - Target false-positive rate, e.g. `0.01` for 1%.
   * @param options - Optional seed.
   * @returns A new, empty filter.
   */
  static create(
    n: number,
    epsilon: number,
    options: CuckooOptions = {},
  ): CuckooFilter {
    return new CuckooFilter({ ...options, n, epsilon });
  }

  /**
   * Constructs a filter from {@link CuckooParams}.
   *
   * @throws {@link ParamError} if a setting is invalid.
   */
  constructor({ n, epsilon, seed = 0 }: CuckooParams) {
    assertPositiveInt(n, "n");
    assertUint32(n, "n");
    assertProbability(epsilon, "epsilon");
    assertUint32(seed, "seed");
    const { f, buckets } = cuckooSizing(n, epsilon);
    this.#n = n;
    this.#epsilon = epsilon;
    this.#seed = seed;
    this.#f = f;
    this.#buckets = buckets;
    // 2 ** f rather than 1 << f, which wraps to 1 at f = 32.
    this.#mask = 2 ** f - 1;
    this.#words = new Uint32Array(Math.ceil((f * SLOTS * buckets) / 32));
  }

  /**
   * Adds `key`. Every call stores a fingerprint, including for a key already
   * present, so each add needs its own delete.
   *
   * @throws {@link CuckooFullError} if the filter has no room for it.
   */
  add(key: BytesLike): void {
    this.#hash(key);
    if (this.#put(this.#i1, this.#fp) || this.#put(this.#i2, this.#fp)) {
      this.#count++;
      return;
    }
    // Both buckets full: displace a resident to its other bucket, and so on
    // down the chain. The start bucket and every victim slot come from the
    // key's own hash, so the same keys in the same order give the same table.
    let i = (HASH.w2 & 1) === 0 ? this.#i1 : this.#i2;
    let x = (HASH.w3 | 1) >>> 0;
    let fp = this.#fp;
    for (let kick = 0; kick < MAX_KICKS; kick++) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      const j = i * SLOTS + (x & 3);
      const victim = this.#slot(j);
      this.#setSlot(j, fp);
      fp = victim;
      i = this.#alt(i, fp);
      if (this.#put(i, fp)) {
        this.#count++;
        return;
      }
    }
    throw new CuckooFullError(
      `cuckoo filter is full at ${String(this.#count)} of ${String(this.capacity)} slots`,
    );
  }

  /**
   * Tests whether `key` may be in the filter.
   *
   * @returns `false` if `key` is definitely absent; `true` if it was added
   * (and not deleted) or on a false positive.
   */
  has(key: BytesLike): boolean {
    this.#hash(key);
    return this.#holds(this.#i1, this.#fp) || this.#holds(this.#i2, this.#fp);
  }

  #hash(key: BytesLike): void {
    hash128KeyInto(key, this.#seed, HASH);
    // 0 marks an empty slot, so a zero fingerprint is stored as 1.
    this.#fp = HASH.w1 >>> (32 - this.#f) || 1;
    this.#i1 = reduce(HASH.w0, this.#buckets);
    this.#i2 = this.#alt(this.#i1, this.#fp);
  }

  /**
   * The other bucket for a fingerprint in bucket `i`: `(mix(fp) - i) mod B`.
   * Applying it twice returns `i` for any bucket count, so the table needs no
   * power-of-two size, and a stored fingerprint can move without its key.
   */
  #alt(i: number, fp: number): number {
    const b = this.#buckets;
    return (((Math.imul(fp, 0x5bd1e995) >>> 0) % b) + b - i) % b;
  }

  #put(bucket: number, fp: number): boolean {
    for (let j = bucket * SLOTS; j < bucket * SLOTS + SLOTS; j++) {
      if (this.#slot(j) === 0) {
        this.#setSlot(j, fp);
        return true;
      }
    }
    return false;
  }

  #holds(bucket: number, fp: number): boolean {
    for (let j = bucket * SLOTS; j < bucket * SLOTS + SLOTS; j++) {
      if (this.#slot(j) === fp) return true;
    }
    return false;
  }

  // Slot j is f bits at stream bit j * f, low bit first; stream bit x is bit
  // x & 31 of word x >>> 5, so a slot may straddle two words.
  #slot(j: number): number {
    const bit = j * this.#f;
    const w = bit >>> 5;
    const off = bit & 31;
    let v = (this.#words[w] ?? 0) >>> off;
    if (off + this.#f > 32) v |= (this.#words[w + 1] ?? 0) << (32 - off);
    return (v & this.#mask) >>> 0;
  }

  #setSlot(j: number, fp: number): void {
    const bit = j * this.#f;
    const w = bit >>> 5;
    const off = bit & 31;
    const words = this.#words;
    words[w] = ((words[w] ?? 0) & ~(this.#mask << off)) | (fp << off);
    if (off + this.#f > 32) {
      const shift = 32 - off;
      words[w + 1] =
        ((words[w + 1] ?? 0) & ~(this.#mask >>> shift)) | (fp >>> shift);
    }
  }

  /** Fingerprints stored, one per add not undone by a delete. */
  get count(): number {
    return this.#count;
  }

  /** Slots in the table, `4 * buckets`. */
  get capacity(): number {
    return SLOTS * this.#buckets;
  }

  /** Number of 4-slot buckets. */
  get buckets(): number {
    return this.#buckets;
  }

  /** Width of each stored fingerprint, in bits. */
  get fingerprintBits(): number {
    return this.#f;
  }

  /** Total slot bits, `fingerprintBits * capacity`. */
  get m(): number {
    return this.#f * this.capacity;
  }

  /** Slot bits per expected key, `m / n`. */
  get bitsPerKey(): number {
    return this.m / this.#n;
  }

  /** Hash seed. */
  get seed(): number {
    return this.#seed;
  }

  /** Target false-positive rate at `n` keys. */
  get epsilon(): number {
    return this.#epsilon;
  }
}
