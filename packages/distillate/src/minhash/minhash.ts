import { assertUint32, ParamError } from "../core/params.js";
import { MINHASH_MAX_K, MINHASH_MIN_K } from "./sizing.js";

// Marks a slot no key has reached. A hash value equal to it is clamped one
// below, so the sentinel never stands for a real minimum.
const EMPTY = 0xffffffff;

function assertK(k: number): void {
  if (!Number.isInteger(k) || k < MINHASH_MIN_K || k > MINHASH_MAX_K) {
    throw new ParamError(
      `k must be an integer in [${String(MINHASH_MIN_K)}, ${String(MINHASH_MAX_K)}], got ${String(k)}`,
    );
  }
}

/** Construction parameters for a {@link MinHash} sketch. */
export interface MinHashParams {
  /** Slots in the signature; defaults to `128`. */
  k?: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A MinHash sketch: estimates the Jaccard similarity of two key sets from
 * fixed-size signatures, in space fixed by `k` rather than by the sets.
 *
 * @example
 * ```ts
 * const a = new MinHash();
 * a.add("alice");
 * ```
 */
export class MinHash {
  readonly #slots: Uint32Array;
  readonly #seed: number;
  // Slots holding a real minimum; zero means the sketch has seen no key.
  #filled = 0;

  /**
   * Creates a sketch with an explicit slot count.
   *
   * @param params - Slot count and optional hash seed.
   */
  constructor({ k = 128, seed = 0 }: MinHashParams = {}) {
    assertK(k);
    assertUint32(seed, "seed");
    this.#slots = new Uint32Array(k).fill(EMPTY);
    this.#seed = seed;
  }

  /** Slots in the signature. */
  get k(): number {
    return this.#slots.length;
  }

  /** The hash seed. */
  get seed(): number {
    return this.#seed;
  }

  /**
   * Standard error of {@link jaccard} at its worst, J = 0.5:
   * `0.5 / sqrt(k)`. Analytic, for reporting.
   */
  get standardError(): number {
    return 0.5 / Math.sqrt(this.#slots.length);
  }

  /** Whether the sketch has seen no key. */
  get isEmpty(): boolean {
    return this.#filled === 0;
  }
}
