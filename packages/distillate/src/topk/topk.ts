import { type BytesLike, normalize } from "../core/bytes.js";
import { hash32x2Into } from "../core/hasher.js";
import { assertPositiveInt, assertUint32, ParamError } from "../core/params.js";
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
  // Reused across add and count so hashing a key allocates nothing per call.
  readonly #words = new Uint32Array(2);
  // Stored counts, where 0 marks an empty slot. A live entry always holds at
  // least 1, since the purge drops everything reaching zero, so occupancy
  // needs no array of its own.
  readonly #counts: Uint32Array;
  // Where each slot's key sits in the arena.
  readonly #keyOffsets: Uint32Array;
  readonly #keyLengths: Uint32Array;
  #arena: Uint8Array;
  #arenaLen = 0;
  #offset = 0;
  #total = 0;

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
    this.#counts = new Uint32Array(capacity);
    this.#keyOffsets = new Uint32Array(capacity);
    this.#keyLengths = new Uint32Array(capacity);
    this.#arena = new Uint8Array(256);
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

  /** Sum of every count recorded, whatever the map has since purged. */
  get total(): number {
    return this.#total;
  }

  // True when the key stored at `slot` is exactly `bytes`.
  #slotHolds(slot: number, bytes: Uint8Array): boolean {
    const len = this.#keyLengths[slot] ?? 0;
    if (len !== bytes.length) return false;
    const at = this.#keyOffsets[slot] ?? 0;
    for (let i = 0; i < len; i++) {
      if (this.#arena[at + i] !== bytes[i]) return false;
    }
    return true;
  }

  // Copy `bytes` into the arena and record where they landed for `slot`.
  #storeKey(slot: number, bytes: Uint8Array): void {
    let arena = this.#arena;
    if (this.#arenaLen + bytes.length > arena.length) {
      let size = arena.length;
      while (size < this.#arenaLen + bytes.length) size *= 2;
      const grown = new Uint8Array(size);
      grown.set(arena.subarray(0, this.#arenaLen));
      arena = grown;
      this.#arena = grown;
    }
    arena.set(bytes, this.#arenaLen);
    this.#keyOffsets[slot] = this.#arenaLen;
    this.#keyLengths[slot] = bytes.length;
    this.#arenaLen += bytes.length;
  }

  /**
   * The slot holding `bytes`, or the first empty slot on its probe path.
   *
   * Unbounded by design: the purge keeps live entries at or below the load
   * limit, which is below capacity, so an empty slot always exists and the
   * scan always returns from inside.
   */
  #slotFor(bytes: Uint8Array): number {
    hash32x2Into(bytes, this.#seed, this.#words);
    const mask = this.#capacity - 1;
    let slot = (this.#words[0] ?? 0) & mask;
    for (;;) {
      if ((this.#counts[slot] ?? 0) === 0) return slot;
      if (this.#slotHolds(slot, bytes)) return slot;
      slot = (slot + 1) & mask;
    }
  }

  /**
   * Records `count` occurrences of a key.
   *
   * @param key - The key to record, as a string or bytes.
   * @param count - How many occurrences to record; defaults to `1`.
   */
  add(key: BytesLike, count = 1): void {
    // A count below 1 would let an estimate fall under the true count, the one
    // thing this structure guarantees cannot happen.
    assertPositiveInt(count, "count");
    const bytes = normalize(key);
    const slot = this.#slotFor(bytes);
    if ((this.#counts[slot] ?? 0) === 0) {
      this.#storeKey(slot, bytes);
    }
    this.#counts[slot] = (this.#counts[slot] ?? 0) + count;
    this.#total += count;
  }

  /**
   * Estimates how many times a key was added.
   *
   * For a key the map holds this is `stored + error()`, never below the true
   * count. A key the map does not hold returns `0` rather than the offset,
   * since its true count may genuinely be zero.
   *
   * @param key - The key to estimate.
   * @returns The estimated count, `0` for a key the map does not hold.
   */
  count(key: BytesLike): number {
    const bytes = normalize(key);
    const stored = this.#counts[this.#slotFor(bytes)] ?? 0;
    return stored === 0 ? 0 : stored + this.#offset;
  }
}
