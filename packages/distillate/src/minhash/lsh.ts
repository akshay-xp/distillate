import { assertUint32 } from "../core/params.js";
import { lshSizing } from "./sizing.js";

/** Construction parameters for a {@link MinHashLSH} index. */
export interface MinHashLSHParams {
  /** Jaccard similarity that should make a pair a candidate. */
  threshold: number;
  /** Slots in every sketch the index takes; defaults to `128`. */
  k?: number;
  /**
   * Cost of a false positive and of a false negative when choosing bands and
   * rows; sum to 1. Defaults to `[0.5, 0.5]`.
   */
  weights?: readonly [number, number];
  /** Hash seed every sketch the index takes must share; defaults to `0`. */
  seed?: number;
}

/**
 * A banded locality-sensitive hashing index over {@link MinHash} signatures:
 * finds the stored keys whose sets are likely at least `threshold` similar to
 * a query, without comparing against every one.
 *
 * @example
 * ```ts
 * const lsh = new MinHashLSH<string>({ threshold: 0.8 });
 * lsh.insert("doc-1", MinHash.from(shingles, 0.05));
 * ```
 */
export class MinHashLSH<K> {
  readonly #threshold: number;
  readonly #k: number;
  readonly #seed: number;
  readonly #bands: number;
  readonly #rows: number;
  // Each stored key with the band keys it was filed under.
  readonly #entries = new Map<K, Float64Array>();

  /**
   * Creates an empty index, choosing bands and rows with `lshSizing`.
   *
   * @param params - Threshold, slot count, weights and seed.
   */
  constructor({ threshold, k = 128, weights, seed = 0 }: MinHashLSHParams) {
    const { bands, rows } = lshSizing(threshold, k, weights);
    assertUint32(seed, "seed");
    this.#threshold = threshold;
    this.#k = k;
    this.#seed = seed;
    this.#bands = bands;
    this.#rows = rows;
  }

  /** Similarity the index was tuned for. */
  get threshold(): number {
    return this.#threshold;
  }

  /** Slots in every sketch the index takes. */
  get k(): number {
    return this.#k;
  }

  /** Hash seed every sketch the index takes must share. */
  get seed(): number {
    return this.#seed;
  }

  /** Bands each signature is cut into. */
  get bands(): number {
    return this.#bands;
  }

  /** Slots per band. */
  get rows(): number {
    return this.#rows;
  }

  /** Keys stored. */
  get size(): number {
    return this.#entries.size;
  }
}
