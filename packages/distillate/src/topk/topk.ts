import { assertUint32, ParamError } from "../core/params.js";
import { TOPK_MAX_CAPACITY, TOPK_MIN_CAPACITY, topKSizing } from "./sizing.js";

/** Options accepted alongside a sizing solve: everything but the geometry. */
export type TopKOptions = Omit<TopKParams, "capacity">;

/** Low-level Top-K sketch parameters. */
export interface TopKParams {
  /** Slots in the counter map; must be a power of two. */
  capacity: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A Top-K sketch: Misra-Gries with reverse purge, answering which keys are
 * heaviest in space fixed by the error you ask for.
 *
 * @example
 * ```ts
 * const sketch = TopK.create(0.001);
 * sketch.add("alice");
 * ```
 */
export class TopK {
  readonly #capacity: number;
  readonly #loadLimit: number;
  readonly #seed: number;

  /**
   * Creates a sketch whose estimate is at most `epsilon` of the total recorded
   * above the true count.
   *
   * Sized by the error it targets rather than by how many keys it will see, or
   * by the k you will ask for: `top(k)` takes k per call.
   *
   * @param epsilon - Error factor relative to the total recorded, e.g. `0.001`.
   * @param options - Optional seed.
   * @returns A new, empty sketch.
   */
  static create(epsilon: number, options: TopKOptions = {}): TopK {
    return new TopK({ ...options, ...topKSizing(epsilon) });
  }

  /**
   * Constructs a sketch from low-level {@link TopKParams}. Prefer
   * {@link TopK.create} unless restoring a specific geometry.
   */
  constructor({ capacity, seed = 0 }: TopKParams) {
    assertUint32(capacity, "capacity");
    assertUint32(seed, "seed");
    // A power of two is what lets the probe mask instead of divide, and what
    // keeps a rebuilt map addressable by the same mask.
    if (!Number.isInteger(Math.log2(capacity))) {
      throw new ParamError(
        `capacity must be a power of two, got ${String(capacity)}`,
      );
    }
    if (capacity < TOPK_MIN_CAPACITY || capacity > TOPK_MAX_CAPACITY) {
      throw new ParamError(
        `capacity must be in [${String(TOPK_MIN_CAPACITY)}, ${String(TOPK_MAX_CAPACITY)}], got ${String(capacity)}`,
      );
    }
    this.#capacity = capacity;
    this.#loadLimit = Math.floor(0.75 * capacity);
    this.#seed = seed;
  }

  /** Slots in the counter map. */
  get capacity(): number {
    return this.#capacity;
  }

  /** Hash seed. */
  get seed(): number {
    return this.#seed;
  }

  /**
   * Error factor the geometry implements, `1 / loadLimit`.
   *
   * Sizing rounds the capacity up to a power of two, so this is at or below the
   * `epsilon` passed to {@link TopK.create}: the sketch reports what it
   * delivers rather than what was asked for.
   */
  get epsilon(): number {
    return 1 / this.#loadLimit;
  }
}
