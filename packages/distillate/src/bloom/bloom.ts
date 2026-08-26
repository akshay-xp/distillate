import { BitSet } from "../core/bitset.js";
import type { BytesLike } from "../core/bytes.js";
import { probeInto } from "../core/hasher.js";
import {
  assertBodyLength,
  assertMinBodyLength,
  bytesEqual,
  type FilterJSON,
  FORMAT_VERSION,
  fromJSONEnvelope,
  HASH_MURMUR128,
  readHeader,
  SerializationError,
  toJSONEnvelope,
  UnknownHashVariantError,
  writeFrame,
} from "../core/serialize.js";
import {
  assertPositiveInt,
  assertProbability,
  assertUint16,
  assertUint32,
} from "../core/params.js";
import { bloomSizing } from "../core/sizing.js";

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
    assertUint32(n, "n");
    assertProbability(epsilon, "epsilon");
    return BloomFilter.#withN(bloomSizing(n, epsilon), n);
  }

  /**
   * Builds a filter from `keys`, sized for their count at the target
   * false-positive rate. The ergonomic entry point when the key set is already
   * in hand; use {@link BloomFilter.create} to size for a count known ahead.
   *
   * @param keys - The keys to insert.
   * @param epsilon - Target false-positive rate, e.g. `0.01` for 1%.
   * @returns A new filter containing every key.
   */
  static from(keys: Iterable<BytesLike>, epsilon: number): BloomFilter {
    const arr = [...keys];
    const f = BloomFilter.create(Math.max(1, arr.length), epsilon);
    for (const k of arr) f.add(k);
    return f;
  }

  /**
   * Restores a filter from its {@link BloomFilter.toBytes} serialization.
   *
   * @param bytes - The serialized filter.
   * @returns The reconstructed filter.
   */
  static fromBytes(bytes: Uint8Array): BloomFilter {
    const { type, flags, body } = readHeader(bytes);
    if (type !== TYPE) {
      throw new SerializationError(
        `expected DSTL type ${String(TYPE)}, got ${String(type)}`,
      );
    }
    if ((flags & 0x0f) !== HASH_MURMUR128) {
      throw new UnknownHashVariantError(
        `unsupported hash variant ${String(flags & 0x0f)}`,
      );
    }
    assertMinBodyLength(body.length, 14, "bloom");
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const m = dv.getUint32(0, true);
    const k = dv.getUint16(4, true);
    const seed = dv.getUint32(6, true);
    const n = dv.getUint32(10, true);
    assertBodyLength(body.length, 14 + Math.ceil(m / 8), "bloom");
    const f = BloomFilter.#withN({ m, k, seed }, n);
    f.#bits.bytes.set(body.subarray(14));
    return f;
  }

  /**
   * Constructs a filter from low-level {@link BloomParams}. Prefer
   * {@link BloomFilter.create} unless restoring a specific configuration.
   */
  constructor({ m, k, seed = 0 }: BloomParams) {
    assertPositiveInt(m, "m");
    assertUint32(m, "m");
    assertPositiveInt(k, "k");
    assertUint16(k, "k");
    assertUint32(seed, "seed");
    this.#bits = new BitSet(m);
    this.#m = m;
    this.#k = k;
    this.#seed = seed;
    this.#scratch = new Uint32Array(k);
    this.#n = Math.round((m * Math.LN2) / k);
  }

  // Reconstruct with an explicit expected-key count, overriding the #n the
  // constructor derives from m/k. The single place #n is carried across
  // reconstruction, so a caller cannot silently drop it.
  static #withN(params: BloomParams, n: number): BloomFilter {
    const f = new BloomFilter(params);
    f.#n = n;
    return f;
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

  /** Number of bits currently set. */
  get length(): number {
    return this.#bits.count();
  }

  /** Analytic design bits-per-key `m / n`. */
  get bitsPerKey(): number {
    return this.#m / this.#n;
  }

  /**
   * Estimates the current false-positive rate from the actual fill,
   * `(length / m) ** k`. This reflects how full the filter is right now, not
   * the design target; it rises as keys are added.
   *
   * @returns The estimated false-positive rate, `0` for an empty filter.
   */
  rate(): number {
    return (this.length / this.#m) ** this.#k;
  }

  /**
   * Serializes the filter to a portable little-endian byte layout.
   *
   * @returns The serialized filter, readable by {@link BloomFilter.fromBytes}.
   */
  toBytes(): Uint8Array {
    const payload = this.#bits.bytes;
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: HASH_MURMUR128 },
      14 + payload.length,
      (body, dv) => {
        dv.setUint32(0, this.#m, true);
        dv.setUint16(4, this.#k, true);
        dv.setUint32(6, this.#seed, true);
        dv.setUint32(10, this.#n, true);
        body.set(payload, 14);
      },
    );
  }

  /**
   * Tests structural equality: `true` when `other` serializes to identical
   * bytes, meaning identical parameters and set bits.
   *
   * @param other - The filter to compare against.
   * @returns `true` if the two filters are byte-for-byte identical.
   */
  equals(other: BloomFilter): boolean {
    return bytesEqual(this.toBytes(), other.toBytes());
  }

  /**
   * Serializes the filter to a JSON-friendly envelope wrapping the base64 of
   * {@link BloomFilter.toBytes}.
   *
   * @returns The envelope, readable by {@link BloomFilter.fromJSON}.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }

  /**
   * Restores a filter from its {@link BloomFilter.toJSON} envelope.
   *
   * @param value - The JSON envelope.
   * @returns The reconstructed filter.
   */
  static fromJSON(value: unknown): BloomFilter {
    return BloomFilter.fromBytes(fromJSONEnvelope(value));
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
    const r = BloomFilter.#withN(
      { m: this.#m, k: this.#k, seed: this.#seed },
      this.#n,
    );
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
