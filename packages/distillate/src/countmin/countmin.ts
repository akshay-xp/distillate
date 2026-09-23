import { assertPositiveInt, assertUint32, ParamError } from "../core/params.js";

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
  readonly #width: number;
  readonly #depth: number;
  readonly #seed: number;

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
}
