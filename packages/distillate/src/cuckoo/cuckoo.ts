import type { BytesLike } from "../core/bytes.js";
import { type Hash128, hash128KeyInto, reduce } from "../core/hasher.js";
import {
  assertPositiveInt,
  assertProbability,
  assertUint32,
  ParamError,
} from "../core/params.js";
import {
  assertBodyLength,
  assertMinBodyLength,
  assertParamsPadding,
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
import { cuckooSizing } from "./sizing.js";

const TYPE = 7;

/**
 * n, seed, epsilon, f, buckets and count occupy 28 bytes, padded to 32 so the
 * slot words start 8-aligned at frame offset 48.
 */
const PARAMS_SIZE = 32;
const PARAMS_FIELDS_END = 28;

const padded8 = (length: number): number => Math.ceil(length / 8) * 8;

const wordBytes = (words: Uint32Array): Uint8Array =>
  new Uint8Array(words.buffer, words.byteOffset, words.byteLength);

/** Slots per bucket. */
const SLOTS = 4;

/** Displacements an add tries before it reports the filter full. */
const MAX_KICKS = 500;

// Each displacement's slot and the fingerprint it held, so a chain that runs
// out of kicks can be undone. Slot indexes can pass 2^32, hence Float64.
const UNDO_SLOT = new Float64Array(MAX_KICKS);
const UNDO_FP = new Uint32Array(MAX_KICKS);

// Reused hash output; safe because every method that hashes is synchronous.
const HASH: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };

// The geometry fromBytes hands the constructor in place of sizing from n and
// epsilon: a frame's stored geometry is authoritative, so frames written
// before a sizing change still load.
let restoring: { f: number; buckets: number } | undefined;

/** Thrown when an add cannot find room; the filter is left exactly as it was. */
export class CuckooFullError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "CuckooFullError";
}

/** Settings for a {@link CuckooFilter}. */
export interface CuckooParams {
  /** Expected number of keys. */
  n: number;
  /** Target false-positive rate at `n` keys, e.g. `0.01` for 1%. */
  epsilon: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/** The optional settings {@link CuckooFilter.create} takes after `n` and `epsilon`. */
export type CuckooOptions = Omit<CuckooParams, "n" | "epsilon">;

/**
 * A cuckoo filter: a set with a tunable false-positive rate, zero false
 * negatives, and delete. Keys are stored as short fingerprints in one of two
 * candidate buckets (Fan et al., "Cuckoo Filter: Practically Better Than
 * Bloom", 2014).
 */
export class CuckooFilter {
  readonly #n: number;
  readonly #epsilon: number;
  readonly #seed: number;
  readonly #f: number;
  readonly #buckets: number;
  readonly #mask: number;
  readonly #words: Uint32Array;
  #count = 0;
  // The last key's fingerprint and candidate buckets, set by #hash.
  #fp = 0;
  #i1 = 0;
  #i2 = 0;

  /**
   * Creates a filter sized for `n` expected keys at a target false-positive rate.
   *
   * @param n - Expected number of keys.
   * @param epsilon - Target false-positive rate, e.g. `0.01` for 1%.
   * @param options - Optional seed.
   * @returns A new, empty filter.
   */
  static create(
    n: number,
    epsilon: number,
    options: CuckooOptions = {},
  ): CuckooFilter {
    return new CuckooFilter({ ...options, n, epsilon });
  }

  /**
   * Builds a filter from the given keys; duplicates are ignored. It is sized
   * for the distinct keys at the target false-positive rate, and holds each
   * once, so a key listed twice needs one delete.
   *
   * @param keys - The keys to insert.
   * @param epsilon - Target false-positive rate, e.g. `0.01` for 1%.
   * @param options - Optional seed.
   * @returns A new filter containing every key.
   */
  static from(
    keys: Iterable<BytesLike>,
    epsilon: number,
    options: CuckooOptions = {},
  ): CuckooFilter {
    // Copies of a key share its two buckets, so repeats fill those long before
    // the table. Deduped on all 128 bits: keys sharing only the bits the filter
    // uses would otherwise collapse into one copy, and deleting either would
    // drop the other.
    const seen = new Set<string>();
    const distinct: BytesLike[] = [];
    for (const key of keys) {
      hash128KeyInto(key, options.seed ?? 0, HASH);
      const id = `${String(HASH.w0)},${String(HASH.w1)},${String(HASH.w2)},${String(HASH.w3)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      distinct.push(key);
    }
    const f = CuckooFilter.create(
      Math.max(1, distinct.length),
      epsilon,
      options,
    );
    for (const k of distinct) f.add(k);
    return f;
  }

  /**
   * Restores a filter from its {@link CuckooFilter.toBytes} serialization.
   *
   * @param bytes - The serialized filter.
   * @returns The reconstructed filter.
   */
  static fromBytes(bytes: Uint8Array): CuckooFilter {
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
    assertMinBodyLength(body.length, PARAMS_SIZE, "cuckoo");
    assertParamsPadding(body, PARAMS_FIELDS_END, PARAMS_SIZE, "cuckoo");
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const params = {
      n: view.getUint32(0, true),
      seed: view.getUint32(4, true),
      epsilon: view.getFloat64(8, true),
    };
    let filter: CuckooFilter;
    try {
      // Length is checked before the constructor allocates, so a forged
      // geometry cannot request memory the body does not hold.
      const f = view.getUint32(16, true);
      const buckets = view.getUint32(20, true);
      const words = Math.ceil((f * SLOTS * buckets) / 32);
      assertBodyLength(body.length, PARAMS_SIZE + padded8(4 * words), "cuckoo");
      restoring = { f, buckets };
      try {
        filter = new CuckooFilter(params);
      } finally {
        restoring = undefined;
      }
    } catch (err) {
      if (err instanceof ParamError) {
        throw new SerializationError(`cuckoo: ${err.message}`);
      }
      throw err;
    }
    const words = filter.#words;
    for (let w = 0; w < words.length; w++) {
      words[w] = view.getUint32(PARAMS_SIZE + 4 * w, true);
    }
    // Unused bits and pad bytes are reserved: a reader that ignored them would
    // let a later release store something there that this one misreads.
    const tail = filter.m % 32;
    if (tail !== 0 && (words[words.length - 1] ?? 0) >>> tail !== 0) {
      throw new SerializationError("cuckoo: bits set past the last slot");
    }
    if (body.subarray(PARAMS_SIZE + 4 * words.length).some((b) => b !== 0)) {
      throw new SerializationError("cuckoo: slot padding is not zero");
    }
    const count = view.getUint32(24, true);
    let occupied = 0;
    for (let j = 0; j < filter.capacity; j++) {
      if (filter.#slot(j) !== 0) occupied++;
    }
    if (count !== occupied) {
      throw new SerializationError(
        `cuckoo: count ${String(count)} does not match ${String(occupied)} occupied slots`,
      );
    }
    filter.#count = count;
    return filter;
  }

  /**
   * Restores a filter from its {@link CuckooFilter.toJSON} envelope.
   *
   * @param value - The parsed JSON envelope.
   * @returns The reconstructed filter.
   */
  static fromJSON(value: unknown): CuckooFilter {
    return CuckooFilter.fromBytes(fromJSONEnvelope(value));
  }

  /**
   * Constructs a filter from {@link CuckooParams}.
   *
   * @throws {@link ParamError} if a setting is invalid.
   */
  constructor({ n, epsilon, seed = 0 }: CuckooParams) {
    assertPositiveInt(n, "n");
    assertUint32(n, "n");
    assertProbability(epsilon, "epsilon");
    assertUint32(seed, "seed");
    const { f, buckets } = restoring ?? cuckooSizing(n, epsilon);
    // Slots are addressed by 32-bit bit offsets (`bit >>> 5`).
    assertUint32(f * SLOTS * buckets, "m");
    this.#n = n;
    this.#epsilon = epsilon;
    this.#seed = seed;
    this.#f = f;
    this.#buckets = buckets;
    // 2 ** f rather than 1 << f, which wraps to 1 at f = 32.
    this.#mask = 2 ** f - 1;
    this.#words = new Uint32Array(Math.ceil((f * SLOTS * buckets) / 32));
  }

  /**
   * Adds `key`. Every call stores a fingerprint, including for a key already
   * present, so each add needs its own delete.
   *
   * @throws {@link CuckooFullError} if the filter has no room for it.
   */
  add(key: BytesLike): void {
    this.#hash(key);
    if (
      this.#replace(this.#i1, 0, this.#fp) ||
      this.#replace(this.#i2, 0, this.#fp)
    ) {
      this.#count++;
      return;
    }
    // Both buckets full: displace a resident to its other bucket, and so on
    // down the chain. The start bucket and every victim slot come from the
    // key's own hash, so the same keys in the same order give the same table.
    let i = (HASH.w2 & 1) === 0 ? this.#i1 : this.#i2;
    let x = (HASH.w3 | 1) >>> 0;
    let fp = this.#fp;
    for (let kick = 0; kick < MAX_KICKS; kick++) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      const j = i * SLOTS + (x & 3);
      const victim = this.#slot(j);
      UNDO_SLOT[kick] = j;
      UNDO_FP[kick] = victim;
      this.#setSlot(j, fp);
      fp = victim;
      i = this.#alt(i, fp);
      if (this.#replace(i, 0, fp)) {
        this.#count++;
        return;
      }
    }
    // Out of kicks, still carrying a resident. Dropping it would be a false
    // negative, so replay the chain backwards and refuse the new key instead.
    for (let kick = MAX_KICKS - 1; kick >= 0; kick--) {
      this.#setSlot(UNDO_SLOT[kick] ?? 0, UNDO_FP[kick] ?? 0);
    }
    throw new CuckooFullError(
      `cuckoo filter is full at ${String(this.#count)} of ${String(this.capacity)} slots`,
    );
  }

  /**
   * Removes one copy of `key`: the first slot holding its fingerprint in
   * either candidate bucket.
   *
   * Only delete keys you added. A key never added can share a fingerprint and
   * bucket with one that was, and deleting it removes that key's fingerprint
   * instead, a false negative the filter cannot detect: it stores fingerprints,
   * not keys, so it cannot tell the two apart.
   *
   * @returns `true` if a matching fingerprint was removed; `false`, with the
   * filter unchanged, if there was none.
   */
  delete(key: BytesLike): boolean {
    this.#hash(key);
    const removed =
      this.#replace(this.#i1, this.#fp, 0) ||
      (this.#i2 !== this.#i1 && this.#replace(this.#i2, this.#fp, 0));
    if (removed) this.#count--;
    return removed;
  }

  /**
   * Tests whether `key` may be in the filter.
   *
   * @returns `false` if `key` is definitely absent; `true` if it was added
   * (and not deleted) or on a false positive.
   */
  has(key: BytesLike): boolean {
    this.#hash(key);
    return (
      this.#find(this.#i1, this.#fp) >= 0 || this.#find(this.#i2, this.#fp) >= 0
    );
  }

  /**
   * Estimates the current false-positive rate from the load: a query compares
   * its fingerprint against about `8 * count / capacity` occupied slots across
   * its two buckets, each matching with probability `1 / (2^f - 1)`.
   *
   * @returns The estimated false-positive rate, `0` for an empty filter.
   */
  rate(): number {
    const occupied = (2 * SLOTS * this.#count) / this.capacity;
    return 1 - (1 - 1 / this.#mask) ** occupied;
  }

  /**
   * Serializes the filter to a DSTL type 7 frame, readable by
   * {@link CuckooFilter.fromBytes} and by any reader of the documented format.
   *
   * @returns The frame bytes.
   */
  toBytes(): Uint8Array {
    const words = this.#words;
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: HASH_MURMUR128 },
      PARAMS_SIZE,
      padded8(4 * words.length),
      (_, view) => {
        view.setUint32(0, this.#n, true);
        view.setUint32(4, this.#seed, true);
        view.setFloat64(8, this.#epsilon, true);
        view.setUint32(16, this.#f, true);
        view.setUint32(20, this.#buckets, true);
        view.setUint32(24, this.#count, true);
        words.forEach((word, w) => {
          view.setUint32(PARAMS_SIZE + 4 * w, word, true);
        });
      },
    );
  }

  /**
   * Whether `other` holds the same settings and slots, so the two serialize to
   * identical bytes. Which slot a key lands in depends on insertion order, so
   * filters holding the same keys can still differ.
   *
   * @param other - The filter to compare against.
   * @returns `true` if the two are indistinguishable.
   */
  equals(other: CuckooFilter): boolean {
    return (
      this.#n === other.#n &&
      this.#epsilon === other.#epsilon &&
      this.#seed === other.#seed &&
      this.#count === other.#count &&
      bytesEqual(wordBytes(this.#words), wordBytes(other.#words))
    );
  }

  /**
   * Serializes the filter as a JSON envelope around its {@link CuckooFilter.toBytes} frame.
   *
   * @returns The JSON-safe envelope.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }

  #hash(key: BytesLike): void {
    hash128KeyInto(key, this.#seed, HASH);
    // 0 marks an empty slot, so a zero fingerprint is stored as 1.
    this.#fp = HASH.w1 >>> (32 - this.#f) || 1;
    this.#i1 = reduce(HASH.w0, this.#buckets);
    this.#i2 = this.#alt(this.#i1, this.#fp);
  }

  /**
   * The other bucket for a fingerprint in bucket `i`: `(mix(fp) - i) mod B`.
   * Applying it twice returns `i` for any bucket count, so the table needs no
   * power-of-two size, and a stored fingerprint can move without its key.
   */
  #alt(i: number, fp: number): number {
    const b = this.#buckets;
    return (((Math.imul(fp, 0x5bd1e995) >>> 0) % b) + b - i) % b;
  }

  /** The first slot in `bucket` holding `value`, or -1. 0 finds an empty slot. */
  #find(bucket: number, value: number): number {
    for (let j = bucket * SLOTS; j < bucket * SLOTS + SLOTS; j++) {
      if (this.#slot(j) === value) return j;
    }
    return -1;
  }

  /** Overwrites the first `from` in `bucket` with `to`; false if there is none. */
  #replace(bucket: number, from: number, to: number): boolean {
    const j = this.#find(bucket, from);
    if (j < 0) return false;
    this.#setSlot(j, to);
    return true;
  }

  // Slot j is f bits at stream bit j * f, low bit first; stream bit x is bit
  // x & 31 of word x >>> 5, so a slot may straddle two words.
  #slot(j: number): number {
    const bit = j * this.#f;
    const w = bit >>> 5;
    const off = bit & 31;
    let v = (this.#words[w] ?? 0) >>> off;
    if (off + this.#f > 32) v |= (this.#words[w + 1] ?? 0) << (32 - off);
    return (v & this.#mask) >>> 0;
  }

  #setSlot(j: number, fp: number): void {
    const bit = j * this.#f;
    const w = bit >>> 5;
    const off = bit & 31;
    const words = this.#words;
    words[w] = ((words[w] ?? 0) & ~(this.#mask << off)) | (fp << off);
    if (off + this.#f > 32) {
      const shift = 32 - off;
      words[w + 1] =
        ((words[w + 1] ?? 0) & ~(this.#mask >>> shift)) | (fp >>> shift);
    }
  }

  /** Fingerprints stored, one per add not undone by a delete. */
  get count(): number {
    return this.#count;
  }

  /** Slots in the table, `4 * buckets`. */
  get capacity(): number {
    return SLOTS * this.#buckets;
  }

  /** Number of 4-slot buckets. */
  get buckets(): number {
    return this.#buckets;
  }

  /** Width of each stored fingerprint, in bits. */
  get fingerprintBits(): number {
    return this.#f;
  }

  /** Total slot bits, `fingerprintBits * capacity`. */
  get m(): number {
    return this.#f * this.capacity;
  }

  /** Slot bits per expected key, `m / n`. */
  get bitsPerKey(): number {
    return this.m / this.#n;
  }

  /** Hash seed. */
  get seed(): number {
    return this.#seed;
  }

  /** Target false-positive rate at `n` keys. */
  get epsilon(): number {
    return this.#epsilon;
  }
}
