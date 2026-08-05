import { BitSet } from "../core/bitset.js";
import type { BytesLike } from "../core/bytes.js";
import { probeInto } from "../core/hasher.js";
import { FORMAT_VERSION, readHeader, writeHeader } from "../core/serialize.js";
import {
  assertPositiveInt,
  assertProbability,
  assertUint32,
} from "../core/params.js";
import { optimal } from "../core/sizing.js";

const TYPE = 1;

/** Thrown when an operation requires two filters built with identical parameters. */
export class BloomParamMismatchError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "BloomParamMismatchError";
}

/** Low-level Bloom filter parameters. */
export interface BloomParams {
  /** Number of bits in the filter. */
  m: number;
  /** Number of hash probes per key. */
  k: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A classic Bloom filter: a space-efficient set with a tunable false-positive
 * rate and zero false negatives.
 *
 * @example
 * ```ts
 * const filter = BloomFilter.create(100_000, 0.01);
 * filter.add("alice");
 * filter.has("alice"); // true
 * filter.has("bob"); // false (or a ~1% false positive)
 * ```
 */
export class BloomFilter {
  readonly #bits: BitSet;
  readonly #m: number;
  readonly #k: number;
  readonly #seed: number;
  readonly #scratch: Uint32Array;
  #n: number;

  /**
   * Creates a filter sized for `n` expected keys at a target false-positive rate.
   *
   * @param n - Expected number of keys.
   * @param epsilon - Target false-positive rate, e.g. `0.01` for 1%.
   * @returns A new, empty filter.
   */
  static create(n: number, epsilon: number): BloomFilter {
    assertPositiveInt(n, "n");
    assertProbability(epsilon, "epsilon");
    const f = new BloomFilter(optimal(n, epsilon));
    f.#n = n;
    return f;
  }

  /**
   * Restores a filter from its {@link BloomFilter.toBytes} serialization.
   *
   * @param bytes - The serialized filter.
   * @returns The reconstructed filter.
   */
  static fromBytes(bytes: Uint8Array): BloomFilter {
    const { body } = readHeader(bytes);
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const m = dv.getUint32(0, true);
    const k = body[4] ?? 0;
    const seed = dv.getUint32(5, true);
    const f = new BloomFilter({ m, k, seed });
    f.#bits.bytes.set(body.subarray(9));
    return f;
  }

  /**
   * Constructs a filter from low-level {@link BloomParams}. Prefer
   * {@link BloomFilter.create} unless restoring a specific configuration.
   */
  constructor({ m, k, seed = 0 }: BloomParams) {
    assertPositiveInt(m, "m");
    assertPositiveInt(k, "k");
    assertUint32(seed, "seed");
    this.#bits = new BitSet(m);
    this.#m = m;
    this.#k = k;
    this.#seed = seed;
    this.#scratch = new Uint32Array(k);
    this.#n = Math.round((m * Math.LN2) / k);
  }

  /** Number of bits in the filter. */
  get m(): number {
    return this.#m;
  }

  /** Number of hash probes per key. */
  get k(): number {
    return this.#k;
  }

  /** Hash seed. */
  get seed(): number {
    return this.#seed;
  }

  /** Analytic design bits-per-key `m / n`. */
  get bitsPerKey(): number {
    return this.#m / this.#n;
  }

  /**
   * Serializes the filter to a portable little-endian byte layout.
   *
   * @returns The serialized filter, readable by {@link BloomFilter.fromBytes}.
   */
  toBytes(): Uint8Array {
    const payload = this.#bits.bytes;
    const body = new Uint8Array(9 + payload.length);
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    dv.setUint32(0, this.#m, true);
    body[4] = this.#k;
    dv.setUint32(5, this.#seed, true);
    body.set(payload, 9);
    return writeHeader({ version: FORMAT_VERSION, type: TYPE, flags: 0 }, body);
  }

  /**
   * Returns a new filter containing the union of this filter and `other`.
   *
   * @param other - A filter built with identical parameters.
   * @returns A new filter reporting membership for keys in either input.
   * @throws {@link BloomParamMismatchError} if the parameters differ.
   */
  union(other: BloomFilter): BloomFilter {
    if (
      this.#m !== other.#m ||
      this.#k !== other.#k ||
      this.#seed !== other.#seed
    ) {
      throw new BloomParamMismatchError(
        "cannot union Bloom filters whose parameters do not match",
      );
    }
    const a = this.#bits.bytes;
    const b = other.#bits.bytes;
    const merged = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) merged[i] = (a[i] ?? 0) | (b[i] ?? 0);
    const r = new BloomFilter({ m: this.#m, k: this.#k, seed: this.#seed });
    r.#bits.bytes.set(merged);
    return r;
  }

  /**
   * Adds a key to the set.
   *
   * @param key - The key to insert, as a string or bytes.
   */
  add(key: BytesLike): void {
    probeInto(key, this.#k, this.#m, this.#seed, this.#scratch);
    for (let i = 0; i < this.#k; i++) this.#bits.set(this.#scratch[i] ?? 0);
  }

  /**
   * Tests whether a key is in the set.
   *
   * @param key - The key to test.
   * @returns `true` if present (possibly a false positive); `false` guarantees absence.
   */
  has(key: BytesLike): boolean {
    probeInto(key, this.#k, this.#m, this.#seed, this.#scratch);
    for (let i = 0; i < this.#k; i++) {
      if (!this.#bits.get(this.#scratch[i] ?? 0)) return false;
    }
    return true;
  }
}
