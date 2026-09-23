import type { BytesLike } from "../core/bytes.js";
import { hash32x2Into, probeAt } from "../core/hasher.js";
import { assertPositiveInt, assertUint32, ParamError } from "../core/params.js";
import { countMinSizing } from "../core/sizing.js";

/** Options accepted alongside a sizing solve: everything but the geometry. */
export type CountMinOptions = Omit<CountMinParams, "width" | "depth">;

/** Low-level Count-Min sketch parameters. */
export interface CountMinParams {
  /** Counters per row. */
  width: number;
  /** Number of rows, one probe each. */
  depth: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A Count-Min sketch: a fixed-size frequency estimate with a tunable
 * overestimate and no underestimate.
 *
 * @example
 * ```ts
 * const sketch = CountMinSketch.create(0.001, 0.001);
 * sketch.add("alice");
 * sketch.add("alice", 3);
 * sketch.count("alice"); // 4 (or a rare overestimate)
 * ```
 */
export class CountMinSketch {
  readonly #counters: Uint32Array;
  readonly #width: number;
  readonly #depth: number;
  readonly #seed: number;
  // Reused across add and count so hashing a key allocates nothing per call.
  readonly #words = new Uint32Array(2);

  /**
   * Creates a sketch whose estimate is at most `epsilon * total` above the
   * true count, with probability `1 - delta`.
   *
   * Unlike a filter, a sketch is sized by the error it targets rather than by
   * how many keys it will see, so no key count is needed.
   *
   * @param epsilon - Error factor relative to the total recorded, e.g. `0.001`.
   * @param delta - Probability the bound is exceeded, e.g. `0.001`.
   * @param options - Optional seed.
   * @returns A new, empty sketch.
   */
  static create(
    epsilon: number,
    delta: number,
    options: CountMinOptions = {},
  ): CountMinSketch {
    return new CountMinSketch({
      ...options,
      ...countMinSizing(epsilon, delta),
    });
  }

  /**
   * Constructs a sketch from low-level {@link CountMinParams}. Prefer
   * {@link CountMinSketch.create} unless restoring a specific geometry.
   */
  constructor({ width, depth, seed = 0 }: CountMinParams) {
    assertPositiveInt(width, "width");
    assertUint32(width, "width");
    assertPositiveInt(depth, "depth");
    assertUint32(depth, "depth");
    assertUint32(seed, "seed");
    // Counters live in one flat array addressed by a 32-bit offset, the same
    // limit BloomFilter puts on m.
    if (width * depth > 0xffffffff) {
      throw new ParamError(
        `width ${String(width)} by depth ${String(depth)} needs ${String(width * depth)} counters, above the maximum ${String(0xffffffff)}`,
      );
    }
    this.#counters = new Uint32Array(width * depth);
    this.#width = width;
    this.#depth = depth;
    this.#seed = seed;
  }

  /** Counters per row. */
  get width(): number {
    return this.#width;
  }

  /** Number of rows, one probe each. */
  get depth(): number {
    return this.#depth;
  }

  /** Hash seed. */
  get seed(): number {
    return this.#seed;
  }

  // Row r's probe for the key hashed into #words, as an offset into #counters.
  #positionAt(row: number): number {
    return (
      row * this.#width +
      probeAt(this.#words[0] ?? 0, this.#words[1] ?? 0, row, this.#width)
    );
  }

  /**
   * Records `count` occurrences of a key.
   *
   * @param key - The key to record, as a string or bytes.
   * @param count - How many occurrences to record; defaults to `1`.
   */
  add(key: BytesLike, count = 1): void {
    hash32x2Into(key, this.#seed, this.#words);
    for (let r = 0; r < this.#depth; r++) {
      const at = this.#positionAt(r);
      this.#counters[at] = (this.#counters[at] ?? 0) + count;
    }
  }

  /**
   * Estimates how many times a key was added. The estimate is never below the
   * true count and is at most {@link CountMinSketch.error} above it.
   *
   * @param key - The key to estimate.
   * @returns The estimated count, `0` for a key the sketch has not seen.
   */
  count(key: BytesLike): number {
    hash32x2Into(key, this.#seed, this.#words);
    let min = Infinity;
    for (let r = 0; r < this.#depth; r++) {
      const at = this.#counters[this.#positionAt(r)] ?? 0;
      if (at < min) min = at;
    }
    return min;
  }
}
