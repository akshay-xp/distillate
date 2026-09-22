import {
  assertPositiveInt,
  assertProbability,
  assertUint32,
} from "../core/params.js";
import { cuckooSizing } from "../core/sizing.js";

/** Slots per bucket. */
const SLOTS = 4;

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
  readonly #count = 0;

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
