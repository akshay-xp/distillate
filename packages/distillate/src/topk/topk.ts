import { type BytesLike, normalize } from "../core/bytes.js";
import { assertPositiveInt, assertUint32, ParamError } from "../core/params.js";
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
import { halfSipHash13 } from "./halfsip.js";
import {
  TOPK_MAX_CAPACITY,
  TOPK_MIN_CAPACITY,
  topKLoadLimit,
  topKPurgeWidth,
  topKSizing,
} from "./sizing.js";

const TYPE = 9;

/**
 * Slots a table starts with. It doubles toward `capacity` as keys arrive, so a
 * sketch costs what it holds rather than what it could hold.
 */
const TABLE_START = 8;

/**
 * Params occupy 24 bytes and the block is padded to 32, so the payload starts
 * at frame offset 48 and its counts and lengths can be mapped as `u32`.
 */
const PARAMS_SIZE = 32;
const PARAMS_FIELDS_END = 24;

/**
 * Rejects a frame's `offset` or `total` unless counting could have produced
 * it: both are `f64` on the wire because both can pass `2^32`, but only a
 * non-negative safe integer is reachable by `add`.
 */
function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SerializationError(
      `topk: ${label} ${String(value)} is not an integer in [0, ${String(Number.MAX_SAFE_INTEGER)}]`,
    );
  }
}

/** Lexicographic order of two byte strings, a proper prefix first. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

/**
 * Thrown when an `add` or `union` would carry a stored count past
 * `2^32 - 1`, or the total past `Number.MAX_SAFE_INTEGER`. Counts are `u32`,
 * so a wrapped one would read back below the truth, the one outcome this
 * structure rules out; a total past the safe range is one `fromBytes`
 * refuses. Every sketch involved is left exactly as it was.
 */
export class TopKOverflowError extends RangeError {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "TopKOverflowError";
}

/** Thrown when an operation requires two sketches built with identical parameters. */
export class TopKParamMismatchError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "TopKParamMismatchError";
}

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
  // The slot hash's secret key, drawn on first use. No stored byte depends on
  // where a key sits, so the key never reaches the frame and can differ per
  // sketch; being secret is what keeps crafted keys off a shared chain.
  #k0 = 0;
  #k1 = 0;
  #keyed = false;
  // Slots in the table now, a power of two up to capacity.
  #size = 0;
  // Stored counts, where 0 marks an empty slot. A live entry always holds at
  // least 1, since the purge drops everything reaching zero, so occupancy
  // needs no array of its own.
  #counts = new Uint32Array(0);
  // Where each slot's key sits in the arena.
  #keyOffsets = new Uint32Array(0);
  #keyLengths = new Uint32Array(0);
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
   * @returns A new, empty sketch.
   */
  static create(epsilon: number): TopK {
    return new TopK(topKSizing(epsilon));
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
   * @returns A new sketch holding every occurrence.
   */
  static from(keys: Iterable<BytesLike>, epsilon: number): TopK {
    const sketch = TopK.create(epsilon);
    for (const key of keys) sketch.add(key);
    return sketch;
  }

  /**
   * Restores a sketch from its {@link TopK.toBytes} serialization.
   *
   * @param bytes - The serialized sketch.
   * @returns The reconstructed sketch.
   */
  static fromBytes(bytes: Uint8Array): TopK {
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
    assertMinBodyLength(body.length, PARAMS_SIZE, "topk");
    assertParamsPadding(body, PARAMS_FIELDS_END, PARAMS_SIZE, "topk");
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const capacity = view.getUint32(0, true);
    const entries = view.getUint32(4, true);
    // The purge never lets a live map past its load limit, and the probe loop
    // relies on that to find an empty slot, so a frame claiming more was not
    // written by this format.
    if (entries > topKLoadLimit(capacity)) {
      throw new SerializationError(
        `topk: frame holds ${String(entries)} entries, above the load limit ${String(topKLoadLimit(capacity))} for capacity ${String(capacity)}`,
      );
    }
    // Keys are variable length, so the body length only follows from the
    // table. Summed as plain numbers so a forged length cannot wrap the sum,
    // and matched exactly so no byte goes unaccounted for.
    const tableEnd = PARAMS_SIZE + 8 * entries;
    assertMinBodyLength(body.length, tableEnd, "topk");
    let keyBytes = 0;
    for (let i = 0; i < entries; i++) {
      keyBytes += view.getUint32(PARAMS_SIZE + 4 * (entries + i), true);
    }
    assertBodyLength(body.length, tableEnd + keyBytes, "topk");
    const offset = view.getFloat64(8, true);
    const total = view.getFloat64(16, true);
    assertCount(offset, "offset");
    assertCount(total, "total");
    let sketch: TopK;
    try {
      sketch = new TopK({ capacity });
      // Sized to what the frame holds, so its cost to read follows its length
      // rather than the capacity it names.
      sketch.#allocate(sketch.#fit(entries));
    } catch (err) {
      // A caller decoding a frame should see one error family.
      if (err instanceof ParamError) {
        throw new SerializationError(`topk: ${err.message}`);
      }
      throw err;
    }
    // Only the canonical order is accepted, so every frame that loads writes
    // back byte for byte, and no two frames decode to the same sketch.
    let keyAt = tableEnd;
    let stored = 0;
    let prevCount = Infinity;
    let prevKey: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < entries; i++) {
      const count = view.getUint32(PARAMS_SIZE + 4 * i, true);
      const len = view.getUint32(PARAMS_SIZE + 4 * (entries + i), true);
      const key = body.subarray(keyAt, keyAt + len);
      keyAt += len;
      // A stored 0 is how the map marks an empty slot.
      if (count === 0) {
        throw new SerializationError(`topk: entry ${String(i)} has count 0`);
      }
      if (
        count > prevCount ||
        (count === prevCount && compareBytes(prevKey, key) >= 0)
      ) {
        throw new SerializationError(
          `topk: entry ${String(i)} is out of canonical order`,
        );
      }
      prevCount = count;
      prevKey = key;
      const slot = sketch.#slotFor(key);
      // Reached only by a key repeated at a different count, which the order
      // check lets through.
      if ((sketch.#counts[slot] ?? 0) !== 0) {
        throw new SerializationError(
          `topk: entry ${String(i)} repeats a key already held`,
        );
      }
      sketch.#storeKey(slot, key);
      sketch.#counts[slot] = count;
      stored += count;
    }
    // Every purge removes at least W times its median while adding the median
    // to the offset, and a union adds both sides, so counting cannot produce a
    // frame past this: it is the bound error() <= epsilon * total itself.
    // Checked once after the loop so a frame's own defects are named first;
    // rounding is monotonic, so a sum past 2^53 still compares above any total.
    const width = topKPurgeWidth(capacity);
    if (stored + width * offset > total) {
      throw new SerializationError(
        `topk: stored counts ${String(stored)} plus ${String(width)} x offset ${String(offset)} exceed total ${String(total)}`,
      );
    }
    sketch.#entries = entries;
    sketch.#offset = offset;
    sketch.#total = total;
    return sketch;
  }

  /**
   * Constructs a sketch from low-level {@link TopKParams}. Prefer
   * {@link TopK.create} unless restoring a specific geometry.
   */
  constructor({ capacity }: TopKParams) {
    assertUint32(capacity, "capacity");
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
    this.#allocate(Math.min(TABLE_START, capacity));
    this.#arena = new Uint8Array(256);
  }

  /** Slots in the counter map. */
  get capacity(): number {
    return this.#capacity;
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
   */
  #purge(): void {
    const keys: Uint8Array[] = [];
    const counts: number[] = [];
    for (let slot = 0; slot < this.#size; slot++) {
      const stored = this.#counts[slot] ?? 0;
      if (stored === 0) continue;
      keys.push(this.#keyAt(slot).slice());
      counts.push(stored);
    }
    this.#reduceTo(keys, counts);
  }

  /**
   * Purges `keys` and `counts` until they fit within the load limit, then
   * rebuilds the table and arena from what survives.
   *
   * Each pass subtracts the upper median, which guarantees at least
   * `(entries >> 1) + 1` entries go, so a purge always makes room. Survivors
   * are rebuilt rather than deleted in place: holes would break the linear
   * probe chains that run through them, and a rebuild also compacts the arena
   * the dropped keys were occupying. Working on lists rather than the table is
   * what lets a union, whose merged entries may outnumber the slots, share it.
   */
  #reduceTo(keys: Uint8Array[], counts: number[]): void {
    while (keys.length > this.#loadLimit) {
      const median = [...counts].sort((a, b) => a - b)[counts.length >> 1] ?? 0;
      let kept = 0;
      for (let i = 0; i < keys.length; i++) {
        const survived = (counts[i] ?? 0) - median;
        if (survived <= 0) continue;
        keys[kept] = keys[i] ?? new Uint8Array(0);
        counts[kept] = survived;
        kept++;
      }
      keys.length = kept;
      counts.length = kept;
      this.#offset += median;
    }

    // Grown to fit a union's survivors, but never shrunk: a table that reached
    // capacity would only grow back as the stream refills it.
    const size = this.#fit(keys.length);
    if (size > this.#size) this.#allocate(size);
    else this.#counts.fill(0);
    this.#arenaLen = 0;
    this.#entries = keys.length;
    for (let i = 0; i < keys.length; i++) {
      const bytes = keys[i] ?? new Uint8Array(0);
      const slot = this.#slotFor(bytes);
      this.#storeKey(slot, bytes);
      this.#counts[slot] = counts[i] ?? 0;
    }
  }

  // Empty slot arrays of `size` slots.
  #allocate(size: number): void {
    this.#size = size;
    this.#counts = new Uint32Array(size);
    this.#keyOffsets = new Uint32Array(size);
    this.#keyLengths = new Uint32Array(size);
  }

  // Moves every live entry into a table of `size` slots. Keys stay where they
  // are in the arena; only the slots pointing at them move.
  #resize(size: number): void {
    const counts = this.#counts;
    const offsets = this.#keyOffsets;
    const lengths = this.#keyLengths;
    this.#allocate(size);
    for (let old = 0; old < counts.length; old++) {
      const stored = counts[old] ?? 0;
      if (stored === 0) continue;
      const at = offsets[old] ?? 0;
      const len = lengths[old] ?? 0;
      const slot = this.#slotFor(this.#arena.subarray(at, at + len));
      this.#counts[slot] = stored;
      this.#keyOffsets[slot] = at;
      this.#keyLengths[slot] = len;
    }
  }

  // The smallest table, up to capacity, whose load limit holds `entries`.
  #fit(entries: number): number {
    let size = Math.min(TABLE_START, this.#capacity);
    while (size < this.#capacity && topKLoadLimit(size) < entries) size *= 2;
    return size;
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
   * Unbounded by design: growth and the purge keep live entries at or below
   * the current table's load limit, which is below its size, so an empty slot
   * always exists and the scan always returns from inside.
   */
  #slotFor(bytes: Uint8Array): number {
    // Drawn here rather than in the constructor: Cloudflare Workers refuse
    // random values at module scope, where a sketch is commonly created.
    if (!this.#keyed) {
      const key = crypto.getRandomValues(new Uint32Array(2));
      this.#k0 = key[0] ?? 0;
      this.#k1 = key[1] ?? 0;
      this.#keyed = true;
    }
    const mask = this.#size - 1;
    let slot = halfSipHash13(bytes, this.#k0, this.#k1) & mask;
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
    // Past the safe range the total loses precision and fromBytes refuses it,
    // so the writer could otherwise produce a frame its own reader rejects.
    if (this.#total + count > Number.MAX_SAFE_INTEGER) {
      throw new TopKOverflowError(
        `adding ${String(count)} would carry the total past ${String(Number.MAX_SAFE_INTEGER)}`,
      );
    }
    const bytes = normalize(key);
    const slot = this.#slotFor(bytes);
    const stored = this.#counts[slot] ?? 0;
    // Checked before the key is stored, so a refused add leaves no entry.
    if (stored + count > 0xffffffff) {
      throw new TopKOverflowError(
        `adding ${String(count)} would carry a stored count past ${String(0xffffffff)}`,
      );
    }
    if (stored === 0) {
      this.#storeKey(slot, bytes);
      this.#entries++;
    }
    this.#counts[slot] = stored + count;
    this.#total += count;
    // Below capacity a full table doubles; at capacity its load limit is the
    // sketch's, and passing it purges exactly where it always did.
    if (this.#entries > topKLoadLimit(this.#size)) {
      if (this.#size < this.#capacity) this.#resize(this.#size * 2);
      else this.#purge();
    }
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
    return this.#canonicalSlots()
      .slice(0, k)
      .map((slot) => {
        const at = this.#keyOffsets[slot] ?? 0;
        return {
          key: this.#arena.slice(at, at + (this.#keyLengths[slot] ?? 0)),
          count: (this.#counts[slot] ?? 0) + this.#offset,
          lowerBound: this.#counts[slot] ?? 0,
        };
      });
  }

  /**
   * Combines this sketch with another built with the same parameters.
   *
   * Each key's stored counts are summed, as are the offsets and totals, and
   * the merged entries are purged until they fit the load limit. The result
   * holds the same guarantee as its inputs, with an error of at least the sum
   * of theirs.
   *
   * Unlike Count-Min's union, this is not the sketch one stream fed both
   * inputs would have produced. Misra-Gries depends on arrival order: a
   * single sketch purges as it goes, while a union purges only what the two
   * inputs kept. Both are correct, and their bytes can differ.
   *
   * @param other - The sketch to combine with.
   * @returns A new sketch; neither input changes.
   */
  union(other: TopK): TopK {
    if (this.#capacity !== other.#capacity) {
      throw new TopKParamMismatchError(
        `cannot union Top-K sketches with capacity ${String(this.#capacity)} and ${String(other.#capacity)}`,
      );
    }
    // Past the safe range the total loses precision and fromBytes refuses it.
    if (this.#total + other.#total > Number.MAX_SAFE_INTEGER) {
      throw new TopKOverflowError(
        `union would carry the total past ${String(Number.MAX_SAFE_INTEGER)}`,
      );
    }
    const keys: Uint8Array[] = [];
    const counts: number[] = [];
    // Which merged entry each of this sketch's slots became, so a key the
    // other side also holds adds to it rather than appearing twice.
    const indexOf = new Int32Array(this.#size).fill(-1);
    for (let slot = 0; slot < this.#size; slot++) {
      const stored = this.#counts[slot] ?? 0;
      if (stored === 0) continue;
      indexOf[slot] = keys.length;
      keys.push(this.#keyAt(slot).slice());
      counts.push(stored);
    }
    for (let slot = 0; slot < other.#size; slot++) {
      const stored = other.#counts[slot] ?? 0;
      if (stored === 0) continue;
      const key = other.#keyAt(slot);
      const at = indexOf[this.#slotFor(key)] ?? -1;
      if (at >= 0) {
        const sum = (counts[at] ?? 0) + stored;
        // A Uint32Array write wraps, so 2^32 would place as an empty slot and
        // the key would read below its true count.
        if (sum > 0xffffffff) {
          throw new TopKOverflowError(
            `union would carry a stored count to ${String(sum)}, past ${String(0xffffffff)}`,
          );
        }
        counts[at] = sum;
      } else {
        keys.push(key.slice());
        counts.push(stored);
      }
    }

    const merged = new TopK({ capacity: this.#capacity });
    merged.#offset = this.#offset + other.#offset;
    merged.#total = this.#total + other.#total;
    merged.#reduceTo(keys, counts);
    return merged;
  }

  /**
   * Serializes the sketch to a portable little-endian byte layout.
   *
   * Entries are written in the order `top` returns them, so the bytes depend
   * only on what the map holds and never on the order it was filled in.
   *
   * @returns The serialized sketch, readable by {@link TopK.fromBytes}.
   */
  toBytes(): Uint8Array {
    const slots = this.#canonicalSlots();
    const tableEnd = PARAMS_SIZE + 8 * slots.length;
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: HASH_MURMUR128 },
      PARAMS_SIZE,
      8 * slots.length + this.#arenaLen,
      (body, view) => {
        view.setUint32(0, this.#capacity, true);
        view.setUint32(4, slots.length, true);
        view.setFloat64(8, this.#offset, true);
        view.setFloat64(16, this.#total, true);
        let keyAt = tableEnd;
        slots.forEach((slot, i) => {
          const at = this.#keyOffsets[slot] ?? 0;
          const len = this.#keyLengths[slot] ?? 0;
          view.setUint32(PARAMS_SIZE + 4 * i, this.#counts[slot] ?? 0, true);
          view.setUint32(PARAMS_SIZE + 4 * (slots.length + i), len, true);
          body.set(this.#arena.subarray(at, at + len), keyAt);
          keyAt += len;
        });
      },
    );
  }

  /**
   * Tests structural equality: `true` when `other` serializes to identical
   * bytes, meaning identical geometry, offset, total and entries.
   *
   * Entries are written in canonical order, so equal bytes mean the same
   * entries are held, whatever order they arrived in.
   *
   * @param other - The sketch to compare against.
   * @returns `true` if the two sketches are byte-for-byte identical.
   */
  equals(other: TopK): boolean {
    return bytesEqual(this.toBytes(), other.toBytes());
  }

  /**
   * Serializes the sketch to a JSON-friendly envelope wrapping the base64 of
   * {@link TopK.toBytes}.
   *
   * @returns The envelope, readable by {@link TopK.fromJSON}.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }

  /**
   * Restores a sketch from its {@link TopK.toJSON} envelope.
   *
   * @param value - The JSON envelope.
   * @returns The reconstructed sketch.
   */
  static fromJSON(value: unknown): TopK {
    return TopK.fromBytes(fromJSONEnvelope(value));
  }

  /**
   * Live slots heaviest first, ties broken on the key bytes, so the order
   * depends on what the map holds rather than on the order it was filled.
   * Frame type 9 writes entries in this order, which is what lets equals be
   * byte equality.
   */
  #canonicalSlots(): number[] {
    const slots: number[] = [];
    for (let slot = 0; slot < this.#size; slot++) {
      if ((this.#counts[slot] ?? 0) !== 0) slots.push(slot);
    }
    return slots.sort((a, b) => {
      const byCount = (this.#counts[b] ?? 0) - (this.#counts[a] ?? 0);
      return byCount !== 0 ? byCount : this.#compareKeys(a, b);
    });
  }

  // Lexicographic order of two slots' stored key bytes.
  #compareKeys(a: number, b: number): number {
    return compareBytes(this.#keyAt(a), this.#keyAt(b));
  }

  // The key stored at `slot`, as a view into the arena.
  #keyAt(slot: number): Uint8Array {
    const at = this.#keyOffsets[slot] ?? 0;
    return this.#arena.subarray(at, at + (this.#keyLengths[slot] ?? 0));
  }
}
