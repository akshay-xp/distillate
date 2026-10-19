import type { BytesLike } from "../core/bytes.js";
import { type Hash128, hash128KeyInto } from "../core/hasher.js";
import { forEachItem } from "../core/iterable.js";
import { assertUint32, ParamError } from "../core/params.js";
import { thetaLowerBound, thetaUpperBound } from "./bounds.js";
import { THETA_MAX_K, THETA_MIN_K, thetaSizing } from "./sizing.js";

// Hashes are 53-bit integers, so they and theta compare as plain doubles.
const HASH_RANGE = 2 ** 53;
const MIN_CAPACITY = 32;

/** Construction parameters for a {@link ThetaSketch}. */
export interface ThetaParams {
  /** Hashes kept once estimating, a power of two in [16, 2^26]; defaults to `4096`. */
  k?: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A Theta sketch: counts distinct keys exactly up to `k`, and past that
 * estimates from the `k` smallest key hashes, within about `1 / sqrt(k)`.
 *
 * @example
 * ```ts
 * const sketch = ThetaSketch.create(0.02);
 * sketch.add("alice");
 * ```
 */
export class ThetaSketch {
  readonly #k: number;
  readonly #seed: number;
  // Open-addressed, linear probing; 0 marks an empty slot.
  #table = new Float64Array(MIN_CAPACITY);
  #size = 0;
  // Hashes at or above theta are not sampled.
  readonly #theta = HASH_RANGE;
  // Reused across add() so hashing a key allocates nothing per call.
  readonly #scratch: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };

  /**
   * Creates a sketch at an explicit `k`.
   *
   * @param params - Sample size and optional hash seed.
   */
  constructor({ k = 4096, seed = 0 }: ThetaParams = {}) {
    if (
      !Number.isInteger(k) ||
      k < THETA_MIN_K ||
      k > THETA_MAX_K ||
      (k & (k - 1)) !== 0
    ) {
      throw new ParamError(
        `k must be a power of two in [${String(THETA_MIN_K)}, ${String(THETA_MAX_K)}], got ${String(k)}`,
      );
    }
    assertUint32(seed, "seed");
    this.#k = k;
    this.#seed = seed;
  }

  /**
   * Creates a sketch whose standard error meets `relativeError`.
   *
   * @param relativeError - Target relative error, e.g. `0.01` for 1%.
   * @returns A new, empty sketch.
   */
  static create(relativeError: number): ThetaSketch {
    return new ThetaSketch(thetaSizing(relativeError));
  }

  /**
   * Creates a sketch counting `keys`, sized to meet `relativeError`.
   *
   * @param keys - The keys to record.
   * @param relativeError - Target relative error, e.g. `0.01` for 1%.
   * @returns A new sketch holding every key.
   */
  static from(keys: Iterable<BytesLike>, relativeError: number): ThetaSketch {
    const sketch = ThetaSketch.create(relativeError);
    forEachItem(keys, (key) => {
      sketch.add(key);
    });
    return sketch;
  }

  /** Hashes kept once the sketch is estimating. */
  get k(): number {
    return this.#k;
  }

  /** Hash seed the sketch was built with. */
  get seed(): number {
    return this.#seed;
  }

  /** Fraction of the hash range sampled, in (0, 1]; `1` while exact. */
  get theta(): number {
    return this.#theta / HASH_RANGE;
  }

  /** Hashes the estimate is computed from. */
  get retained(): number {
    return this.#size;
  }

  /** Whether no key has been added. */
  get isEmpty(): boolean {
    return this.#size === 0;
  }

  /** Whether `count()` estimates rather than counts. */
  get isEstimating(): boolean {
    return this.#theta < HASH_RANGE;
  }

  /**
   * Records a key. Adding a key already seen leaves the sketch unchanged.
   *
   * @param key - The key to record.
   */
  add(key: BytesLike): void {
    const s = this.#scratch;
    hash128KeyInto(key, this.#seed, s);
    const hash = (s.w1 >>> 11) * 2 ** 32 + s.w0;
    // A zero hash would read as an empty slot; it is dropped, at odds of 2^-53.
    if (hash === 0 || hash >= this.#theta) return;

    const table = this.#table;
    const mask = table.length - 1;
    let slot = s.w0 & mask;
    for (;;) {
      const held = table[slot] ?? 0;
      if (held === hash) return;
      if (held === 0) break;
      slot = (slot + 1) & mask;
    }
    table[slot] = hash;
    if (++this.#size * 2 > table.length) this.#resize(table.length * 2);
  }

  /**
   * Counts the distinct keys added: exact while not {@link isEstimating}.
   *
   * @returns The distinct count, or its estimate.
   */
  count(): number {
    return this.#size / this.theta;
  }

  /**
   * @param sd - Standard deviations: `1`, `2` or `3`.
   * @returns A lower bound on the distinct count; `count()` while exact.
   */
  lowerBound(sd: number): number {
    return thetaLowerBound(this.#size, this.theta, sd);
  }

  /**
   * @param sd - Standard deviations: `1`, `2` or `3`.
   * @returns An upper bound on the distinct count; `count()` while exact.
   */
  upperBound(sd: number): number {
    return thetaUpperBound(this.#size, this.theta, sd);
  }

  #resize(capacity: number): void {
    const old = this.#table;
    const table = new Float64Array(capacity);
    const mask = capacity - 1;
    for (const hash of old) {
      if (hash === 0) continue;
      // The low bits of a hash are its w0's, the slot add() would pick.
      let slot = hash % capacity;
      while (table[slot] !== 0) slot = (slot + 1) & mask;
      table[slot] = hash;
    }
    this.#table = table;
  }
}
