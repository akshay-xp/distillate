import { BitSet } from "../core/bitset.js";
import {
  assertPositiveInt,
  assertProbability,
  assertUint32,
  ParamError,
} from "../core/params.js";
import { bloomSizing } from "../core/sizing.js";

const MAX_BITS = 0xffffffff;

/** Settings for a {@link ScalableBloomFilter}. */
export interface ScalableBloomParams {
  /** Keys the first stage holds before the next one opens. */
  n: number;
  /** Target false-positive rate for the whole chain, e.g. `0.01` for 1%. */
  epsilon: number;
  /** Capacity multiplier from one stage to the next; defaults to `2`. */
  growth?: number;
  /**
   * Multiplier on each stage's false-positive target relative to the one
   * before; defaults to `0.85`. Lower spends more bits per stage to open
   * fewer of them.
   */
  tightening?: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

interface Stage {
  readonly bits: BitSet;
  readonly m: number;
  readonly k: number;
  readonly capacity: number;
  count: number;
}

/**
 * A Bloom filter that grows with its key count and keeps its false-positive
 * rate under `epsilon`, for when the number of keys is not known up front.
 *
 * It is a chain of Bloom stages. Stage `i` holds `n * growth ** i` keys at a
 * false-positive target of `epsilon * (1 - tightening) * tightening ** i`;
 * those targets sum to at most `epsilon`, however many stages open.
 *
 * @example
 * ```ts
 * const seen = ScalableBloomFilter.create(1000, 0.01);
 * seen.add("alice");
 * seen.has("alice"); // true
 * ```
 */
export class ScalableBloomFilter {
  readonly #n: number;
  readonly #epsilon: number;
  readonly #growth: number;
  readonly #tightening: number;
  readonly #seed: number;
  readonly #stages: Stage[] = [];

  /**
   * Creates a filter whose first stage holds `n` keys, for a chain-wide
   * false-positive target.
   *
   * @param n - Keys the first stage holds.
   * @param epsilon - Target false-positive rate for the whole chain.
   * @param options - Optional growth, tightening and seed.
   * @returns A new, empty filter.
   */
  static create(
    n: number,
    epsilon: number,
    options: Omit<ScalableBloomParams, "n" | "epsilon"> = {},
  ): ScalableBloomFilter {
    return new ScalableBloomFilter({ ...options, n, epsilon });
  }

  /**
   * @param params - The filter's settings.
   * @throws {@link ParamError} if a setting is out of range, or the first
   *   stage would need more than `2^32 - 1` bits.
   */
  constructor({
    n,
    epsilon,
    growth = 2,
    tightening = 0.85,
    seed = 0,
  }: ScalableBloomParams) {
    assertPositiveInt(n, "n");
    assertUint32(n, "n");
    assertProbability(epsilon, "epsilon");
    if (!Number.isFinite(growth) || growth <= 1) {
      throw new ParamError(
        `growth must be a finite number greater than 1, got ${String(growth)}`,
      );
    }
    assertProbability(tightening, "tightening");
    assertUint32(seed, "seed");
    this.#n = n;
    this.#epsilon = epsilon;
    this.#growth = growth;
    this.#tightening = tightening;
    this.#seed = seed;

    const first = this.#geometry(0);
    if (first.m > MAX_BITS) {
      throw new ParamError(
        `the first stage needs ${String(first.m)} bits, more than ${String(MAX_BITS)}`,
      );
    }
    this.#open(first);
  }

  // Stage i's capacity and Bloom geometry. The false-positive targets form a
  // geometric series summing to at most epsilon, which is the chain's bound.
  #geometry(i: number): { capacity: number; m: number; k: number } {
    const capacity = Math.ceil(this.#n * this.#growth ** i);
    const target =
      this.#epsilon * (1 - this.#tightening) * this.#tightening ** i;
    return { capacity, ...bloomSizing(capacity, target) };
  }

  #open({ capacity, m, k }: { capacity: number; m: number; k: number }): void {
    this.#stages.push({ bits: new BitSet(m), m, k, capacity, count: 0 });
  }

  /** Keys added that the filter did not already hold. */
  get count(): number {
    return this.#stages.reduce((sum, s) => sum + s.count, 0);
  }

  /** Keys the open stages hold between them before the next one opens. */
  get capacity(): number {
    return this.#stages.reduce((sum, s) => sum + s.capacity, 0);
  }

  /** Number of open stages. */
  get stages(): number {
    return this.#stages.length;
  }

  /** Total bits across every stage. */
  get m(): number {
    return this.#stages.reduce((sum, s) => sum + s.m, 0);
  }

  /** Analytic design bits-per-key, `m / capacity`. */
  get bitsPerKey(): number {
    return this.m / this.capacity;
  }

  /** Hash seed shared by every stage. */
  get seed(): number {
    return this.#seed;
  }

  /** Target false-positive rate for the whole chain. */
  get epsilon(): number {
    return this.#epsilon;
  }

  /** Capacity multiplier from one stage to the next. */
  get growth(): number {
    return this.#growth;
  }

  /** False-positive target multiplier from one stage to the next. */
  get tightening(): number {
    return this.#tightening;
  }
}
