import { type BytesLike, normalize } from "../core/bytes.js";
import { hash32x2Into } from "../core/hasher.js";
import { assertPositiveInt, assertUint32, ParamError } from "../core/params.js";
import {
  TOPK_MAX_CAPACITY,
  TOPK_MIN_CAPACITY,
  topKLoadLimit,
  topKPurgeWidth,
  topKSizing,
} from "./sizing.js";

/** Options accepted alongside a sizing solve: everything but the geometry. */
export type TopKOptions = Omit<TopKParams, "capacity">;

/** One of the heaviest keys, with the bracket its stored count implies. */
export interface TopKEntry {
  /** The key exactly as it was recorded. A copy, safe to keep or mutate. */
  key: Uint8Array;
  /** Upper bound, `stored + error()`. Never below the true count. */
  count: number;
  /** Lower bound, the stored count alone. Never above the true count. */
  lowerBound: number;
}

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
  #entries = 0;
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
   * Builds a sketch recording `keys`, at the target error bound. The
   * ergonomic entry point when the stream is already in hand.
   *
   * A repeated key is counted once per occurrence, which is the whole point of
   * a frequency sketch. This is the opposite of `CuckooFilter.from`, where a
   * repeat costs a slot and is therefore dropped.
   *
   * @param keys - The keys to record, repeats included.
   * @param epsilon - Error factor relative to the total recorded.
   * @param options - Optional seed.
   * @returns A new sketch holding every occurrence.
   */
  static from(
    keys: Iterable<BytesLike>,
    epsilon: number,
    options: TopKOptions = {},
  ): TopK {
    const sketch = TopK.create(epsilon, options);
    for (const key of keys) sketch.add(key);
    return sketch;
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
    this.#loadLimit = topKLoadLimit(capacity);
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
   * Error factor the geometry implements, `1 / topKPurgeWidth(capacity)`.
   *
   * Sizing rounds the capacity up to a power of two, so this is at or below the
   * `epsilon` passed to {@link TopK.create}: the sketch reports what it
   * delivers rather than what was asked for.
   */
  get epsilon(): number {
    return 1 / topKPurgeWidth(this.#capacity);
  }

  /** Sum of every count recorded, whatever the map has since purged. */
  get total(): number {
    return this.#total;
  }

  /**
   * The most any estimate can exceed the truth by: everything the purges have
   * subtracted so far.
   *
   * It is also the threshold of the one-sided guarantee. Every key whose true
   * count exceeds this is still held, so nothing heavier than the error can
   * have been silently dropped.
   *
   * @returns The accumulated purge offset, `0` before the first purge.
   */
  error(): number {
    return this.#offset;
  }

  /**
   * Subtracts the median stored count from every entry, drops those reaching
   * zero, and charges what was subtracted to the offset.
   *
   * The upper median guarantees at least `(entries >> 1) + 1` entries go, so a
   * purge always makes room. Survivors are rebuilt into a fresh table and
   * arena rather than deleted in place: holes would break the linear probe
   * chains that run through them, and a rebuild also compacts the arena that
   * the dropped keys were occupying.
   */
  #purge(): void {
    const live: number[] = [];
    for (let slot = 0; slot < this.#capacity; slot++) {
      const stored = this.#counts[slot] ?? 0;
      if (stored !== 0) live.push(stored);
    }
    live.sort((a, b) => a - b);
    const median = live[live.length >> 1] ?? 0;

    const keys: Uint8Array[] = [];
    const counts: number[] = [];
    for (let slot = 0; slot < this.#capacity; slot++) {
      const stored = this.#counts[slot] ?? 0;
      if (stored === 0) continue;
      const survived = stored - median;
      if (survived <= 0) continue;
      const at = this.#keyOffsets[slot] ?? 0;
      keys.push(this.#arena.slice(at, at + (this.#keyLengths[slot] ?? 0)));
      counts.push(survived);
    }

    this.#counts.fill(0);
    this.#arenaLen = 0;
    this.#entries = keys.length;
    for (let i = 0; i < keys.length; i++) {
      const bytes = keys[i] ?? new Uint8Array(0);
      const slot = this.#slotFor(bytes);
      this.#storeKey(slot, bytes);
      this.#counts[slot] = counts[i] ?? 0;
    }
    this.#offset += median;
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
      this.#entries++;
    }
    this.#counts[slot] = (this.#counts[slot] ?? 0) + count;
    this.#total += count;
    if (this.#entries > this.#loadLimit) this.#purge();
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

  /**
   * The `k` heaviest keys the map holds, heaviest first.
   *
   * `k` is taken per call rather than fixed when the sketch was built, so one
   * sketch answers top-10 and top-100 without a rebuild.
   *
   * Fewer than `k` entries come back when the map holds fewer, and a key
   * purged away is not among them: what is guaranteed present is every key
   * whose true count exceeds {@link TopK.error}.
   *
   * @param k - How many entries to return at most.
   * @returns The heaviest entries, each with its upper and lower bound.
   */
  top(k: number): TopKEntry[] {
    assertPositiveInt(k, "k");
    const slots: number[] = [];
    for (let slot = 0; slot < this.#capacity; slot++) {
      if ((this.#counts[slot] ?? 0) !== 0) slots.push(slot);
    }
    // Ties break on the key bytes, so the order depends on what the map holds
    // rather than on the order it was filled. Frame type 9 writes entries in
    // this same order, which is what lets equals be byte equality.
    slots.sort((a, b) => {
      const byCount = (this.#counts[b] ?? 0) - (this.#counts[a] ?? 0);
      return byCount !== 0 ? byCount : this.#compareKeys(a, b);
    });
    return slots.slice(0, k).map((slot) => {
      const at = this.#keyOffsets[slot] ?? 0;
      return {
        key: this.#arena.slice(at, at + (this.#keyLengths[slot] ?? 0)),
        count: (this.#counts[slot] ?? 0) + this.#offset,
        lowerBound: this.#counts[slot] ?? 0,
      };
    });
  }

  // Lexicographic order of two slots' stored key bytes.
  #compareKeys(a: number, b: number): number {
    const aAt = this.#keyOffsets[a] ?? 0;
    const bAt = this.#keyOffsets[b] ?? 0;
    const aLen = this.#keyLengths[a] ?? 0;
    const bLen = this.#keyLengths[b] ?? 0;
    for (let i = 0; i < Math.min(aLen, bLen); i++) {
      const diff = (this.#arena[aAt + i] ?? 0) - (this.#arena[bAt + i] ?? 0);
      if (diff !== 0) return diff;
    }
    return aLen - bLen;
  }
}
