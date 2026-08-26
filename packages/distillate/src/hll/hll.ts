import type { BytesLike } from "../core/bytes.js";
import { hash128KeyInto, type Hash128 } from "../core/hasher.js";
import { assertUint32, ParamError } from "../core/params.js";
import { HLL_MAX_P, HLL_MIN_P, hllSizing } from "../core/sizing.js";
import { estimate } from "./estimate.js";
import { Registers } from "./registers.js";

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
    const index = s.w0 >>> (32 - p);
    const tail = (s.w0 << p) >>> 0;
    const rho =
      tail !== 0 ? Math.clz32(tail) + 1 : 32 - p + Math.clz32(s.w1) + 1;

    if (rho > this.#registers.get(index)) this.#registers.set(index, rho);
  }

  /**
   * Estimates how many distinct keys have been added.
   *
   * @returns The estimated cardinality; `0` for an empty sketch.
   */
  count(): number {
    const p = this.#p;
    const q = 64 - p;
    const m = 2 ** p;
    const hist = new Int32Array(q + 2);
    for (let i = 0; i < m; i++) {
      const value = this.#registers.get(i);
      hist[value] = (hist[value] ?? 0) + 1;
    }
    return estimate(hist, p);
  }
}
