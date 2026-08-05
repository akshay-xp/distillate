import { type BytesLike } from "../core/bytes.js";
import { hash32x2Into, reduce } from "../core/hasher.js";
import {
  assertPositiveFinite,
  assertPositiveInt,
  assertProbability,
  assertUint32,
} from "../core/params.js";
import {
  assertBodyLength,
  assertMinBodyLength,
  FORMAT_VERSION,
  HASH_MURMUR32,
  readHeader,
  SerializationError,
  UnknownHashVariantError,
  writeHeader,
} from "../core/serialize.js";

const TYPE = 2;

// Canonical split-block bit-position multipliers (Parquet/Impala): odd 32-bit
// constants that spread one 32-bit hash across the 8 lanes of a block.
const SALT = Uint32Array.of(
  0x47b6137b,
  0x44974d91,
  0x8824ad5b,
  0xa2b7289d,
  0x705495c7,
  0x2df1424b,
  0x9efc4947,
  0x5c6bfb31,
);

// Reused two-word hash output across fillBlock calls; safe because hashing is
// synchronous and non-reentrant (same rationale as the hasher's scratch).
const scratch2 = new Uint32Array(2);

/** Thrown when an operation requires two filters built with identical parameters. */
export class BlockedBloomParamMismatchError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "BlockedBloomParamMismatchError";
}

/** Low-level blocked Bloom filter parameters. */
export interface BlockedBloomParams {
  /** Bits allocated per key; higher lowers the false-positive rate. */
  bitsPerKey: number;
  /** Expected number of keys. */
  capacity: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A blocked (split-block) Bloom filter: confines every lookup to a single cache
 * line, trading ~20-30% more space for cache-friendly throughput.
 *
 * @example
 * ```ts
 * const filter = BlockedBloomFilter.create(100_000, 0.01);
 * filter.add("alice");
 * filter.has("alice"); // true
 * ```
 */
export class BlockedBloomFilter {
  readonly #lanes: Uint32Array;
  readonly #numBlocks: number;
  readonly #seed: number;
  #n: number;
  readonly #words = new Uint32Array(8);
  readonly #bits = new Uint32Array(8);

  // Bits-per-key vs target FPR for split-block (8 lanes, 256-bit blocks),
  // as (log10(1/epsilon), bitsPerKey). Carries the clustering penalty of
  // confining all probes to one block. Source: Parquet split-block table.
  static #ANCHORS: readonly [number, number][] = [
    [2, 10.5],
    [3, 16.9],
    [4, 26.4],
  ];

  /**
   * Creates a filter sized for `n` expected keys at a target false-positive rate.
   *
   * @param n - Expected number of keys.
   * @param epsilon - Target false-positive rate, e.g. `0.01` for 1%.
   * @returns A new, empty filter.
   */
  static create(n: number, epsilon: number): BlockedBloomFilter {
    assertPositiveInt(n, "n");
    assertProbability(epsilon, "epsilon");
    const t = Math.log10(1 / epsilon);
    const a = BlockedBloomFilter.#ANCHORS;
    // Segment to interpolate on: the first whose upper anchor is >= t;
    // clamped to a real segment so t outside the anchors extrapolates.
    let seg = a.findIndex((p) => t <= p[0]);
    if (seg < 1) seg = seg === -1 ? a.length - 1 : 1;
    const [t0, b0] = a[seg - 1] ?? [0, 0];
    const [t1, b1] = a[seg] ?? [0, 0];
    const bitsPerKey = b0 + ((b1 - b0) / (t1 - t0)) * (t - t0);
    return new BlockedBloomFilter({
      bitsPerKey: Math.max(1, Math.ceil(bitsPerKey)),
      capacity: n,
    });
  }

  /**
   * Constructs a filter from low-level {@link BlockedBloomParams}. Prefer
   * {@link BlockedBloomFilter.create} unless restoring a specific configuration.
   */
  constructor({ bitsPerKey, capacity, seed = 0 }: BlockedBloomParams) {
    assertPositiveFinite(bitsPerKey, "bitsPerKey");
    assertPositiveInt(capacity, "capacity");
    assertUint32(seed, "seed");
    this.#numBlocks = Math.max(1, Math.ceil((bitsPerKey * capacity) / 256));
    this.#lanes = new Uint32Array(this.#numBlocks * 8);
    this.#seed = seed;
    this.#n = capacity;
  }

  /** Actual bits allocated per key (`total bits / capacity`). */
  get bitsPerKey(): number {
    return (this.#numBlocks * 256) / this.#n;
  }

  /** Number of bits currently set across all lanes. */
  get length(): number {
    let bits = 0;
    for (let w of this.#lanes) {
      while (w) {
        w &= w - 1;
        bits++;
      }
    }
    return bits;
  }

  /**
   * Estimates the current false-positive rate from the actual fill,
   * `(length / totalBits) ** 8`. A split-block query checks exactly 8 lane-bits,
   * so the exponent is 8 rather than a classic probe count `k`. This reflects
   * how full the filter is right now, not the design target.
   *
   * @returns The estimated false-positive rate, `0` for an empty filter.
   */
  rate(): number {
    return (this.length / (this.#numBlocks * 256)) ** 8;
  }

  /**
   * Restores a filter from its {@link BlockedBloomFilter.toBytes} serialization.
   *
   * @param bytes - The serialized filter.
   * @returns The reconstructed filter.
   */
  static fromBytes(bytes: Uint8Array): BlockedBloomFilter {
    const { type, flags, body } = readHeader(bytes);
    if (type !== TYPE) {
      throw new SerializationError(
        `expected AMQF type ${String(TYPE)}, got ${String(type)}`,
      );
    }
    if ((flags & 0x0f) !== HASH_MURMUR32) {
      throw new UnknownHashVariantError(
        `unsupported hash variant ${String(flags & 0x0f)}`,
      );
    }
    assertMinBodyLength(body.length, 12, "blocked");
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const numBlocks = dv.getUint32(0, true);
    const seed = dv.getUint32(4, true);
    const n = dv.getUint32(8, true);
    assertBodyLength(body.length, 12 + numBlocks * 32, "blocked");
    // bitsPerKey 256 with capacity=numBlocks reconstructs exactly numBlocks
    // blocks (256*numBlocks/256); #n is then restored to the stored capacity.
    const f = new BlockedBloomFilter({
      bitsPerKey: 256,
      capacity: numBlocks,
      seed,
    });
    f.#n = n;
    new Uint8Array(f.#lanes.buffer).set(body.subarray(12));
    return f;
  }

  /**
   * Serializes the filter to a portable little-endian byte layout.
   *
   * @returns The serialized filter, readable by {@link BlockedBloomFilter.fromBytes}.
   */
  toBytes(): Uint8Array {
    const lanes = new Uint8Array(
      this.#lanes.buffer,
      this.#lanes.byteOffset,
      this.#lanes.byteLength,
    );
    const body = new Uint8Array(12 + lanes.length);
    const dv = new DataView(body.buffer);
    dv.setUint32(0, this.#numBlocks, true);
    dv.setUint32(4, this.#seed, true);
    dv.setUint32(8, this.#n, true);
    body.set(lanes, 12);
    return writeHeader(
      { version: FORMAT_VERSION, type: TYPE, flags: HASH_MURMUR32 },
      body,
    );
  }

  /**
   * Returns a new filter containing the union of this filter and `other`.
   *
   * @param other - A filter built with identical parameters.
   * @returns A new filter reporting membership for keys in either input.
   * @throws {@link BlockedBloomParamMismatchError} if the parameters differ.
   */
  union(other: BlockedBloomFilter): BlockedBloomFilter {
    if (this.#numBlocks !== other.#numBlocks || this.#seed !== other.#seed) {
      throw new BlockedBloomParamMismatchError(
        "cannot union blocked Bloom filters whose parameters do not match",
      );
    }
    const r = new BlockedBloomFilter({
      bitsPerKey: this.bitsPerKey,
      capacity: this.#n,
      seed: this.#seed,
    });
    for (let i = 0; i < this.#lanes.length; i++)
      r.#lanes[i] = (this.#lanes[i] ?? 0) | (other.#lanes[i] ?? 0);
    return r;
  }

  /**
   * Adds a key to the set.
   *
   * @param key - The key to insert, as a string or bytes.
   */
  add(key: BytesLike): void {
    fillBlock(key, this.#numBlocks, this.#seed, this.#words, this.#bits);
    for (let i = 0; i < 8; i++) {
      const w = this.#words[i] ?? 0;
      this.#lanes[w] = (this.#lanes[w] ?? 0) | (this.#bits[i] ?? 0);
    }
  }

  /**
   * Tests whether a key is in the set.
   *
   * @param key - The key to test.
   * @returns `true` if present (possibly a false positive); `false` guarantees absence.
   */
  has(key: BytesLike): boolean {
    fillBlock(key, this.#numBlocks, this.#seed, this.#words, this.#bits);
    for (let i = 0; i < 8; i++) {
      const bit = this.#bits[i] ?? 0;
      if (((this.#lanes[this.#words[i] ?? 0] ?? 0) & bit) >>> 0 !== bit)
        return false;
    }
    return true;
  }
}

// Split-block probe: derive one block index and 8 single-bit lane masks for
// `key`. Writes lane word indices into `outWords` and their masks into `outBits`
// (both length 8, caller-owned so no per-call allocation). A block is 256 bits =
// 8 contiguous 32-bit lanes; word `block*8 + i` gets one bit set.
export function fillBlock(
  key: BytesLike,
  numBlocks: number,
  seed: number,
  outWords: Uint32Array,
  outBits: Uint32Array,
): void {
  hash32x2Into(key, seed, scratch2);
  const block = reduce(scratch2[0] ?? 0, numBlocks);
  const x = scratch2[1] ?? 0;
  const base = block * 8;
  for (let i = 0; i < 8; i++) {
    outWords[i] = base + i;
    outBits[i] = (1 << (Math.imul(x, SALT[i] ?? 0) >>> 27)) >>> 0;
  }
}
