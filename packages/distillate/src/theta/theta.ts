import type { BytesLike } from "../core/bytes.js";
import { type Hash128, hash128KeyInto } from "../core/hasher.js";
import { forEachItem } from "../core/iterable.js";
import { assertUint32, ParamError } from "../core/params.js";
import {
  assertBodyLength,
  assertMinBodyLength,
  assertParamsPadding,
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
import { thetaLowerBound, thetaUpperBound } from "./bounds.js";
import { THETA_MAX_K, THETA_MIN_K, thetaSizing } from "./sizing.js";

// Hashes are 53-bit integers, so they and theta compare as plain doubles.
const HASH_RANGE = 2 ** 53;
const MIN_CAPACITY = 32;

/** DSTL frame type for a Theta sketch. */
const TYPE = 13;

/**
 * Body layout: seed (u32 LE) | k (u32 LE) | theta (u64 LE) | count (u32 LE) |
 * 4 bytes padding | count hashes (u64 LE), strictly ascending, each in
 * [1, theta). Params occupy 20 bytes; the block is padded to 24 so the hashes
 * start at frame offset 40, where a typed u64 view can sit. Only the canonical
 * sample is written, so equal key sets give equal bytes.
 */
const PARAMS_SIZE = 24;
const PARAMS_FIELDS_END = 20;

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
 * Hashes live in a table of up to `2k` slots. Once it is full to 3/4, a
 * quickselect keeps the `k` smallest and lowers theta to the next, so a key
 * hashing above theta is rejected without touching the table (QuickSelect, as
 * in Apache DataSketches).
 *
 * When those rebuilds run depends on the order keys arrive in, so the table
 * itself does not. Every rebuild's theta is the (k+1)-th smallest hash seen so
 * far, never below the true one, so the table always holds the true `k`
 * smallest. Every read goes through that canonical sample: the `k` smallest
 * hashes, theta the next. Equal key sets then answer alike whatever the order.
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
  #theta = HASH_RANGE;
  // The live hashes, sorted: the canonical sample is the first min(size, k).
  // Also the rebuild's quickselect space, which leaves it stale.
  #sorted = new Float64Array(0);
  #stale = true;
  #canonTheta = HASH_RANGE;
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

  /**
   * Restores a sketch from {@link ThetaSketch.toBytes}. It takes keys and
   * set operations like the sketch it was written from.
   *
   * @param bytes - The serialized sketch.
   * @returns The reconstructed sketch.
   */
  static fromBytes(bytes: Uint8Array): ThetaSketch {
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
    assertMinBodyLength(body.length, PARAMS_SIZE, "theta");
    assertParamsPadding(body, PARAMS_FIELDS_END, PARAMS_SIZE, "theta");
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const seed = view.getUint32(0, true);
    const k = view.getUint32(4, true);
    const theta = readU64(view, 8);
    const count = view.getUint32(16, true);
    assertBodyLength(body.length, PARAMS_SIZE + 8 * count, "theta");
    if (theta < 1 || theta > HASH_RANGE) {
      throw new SerializationError(
        `theta: theta ${String(theta)} is outside [1, 2^53]`,
      );
    }
    if (count > k) {
      throw new SerializationError(
        `theta: ${String(count)} hashes is more than k = ${String(k)} keeps`,
      );
    }
    // Strictly ascending, from 1 up to theta: a canonical sample, so a
    // decoded sketch answers as the one that wrote it.
    const hashes = new Float64Array(count);
    let previous = 0;
    for (let i = 0; i < count; i++) {
      const hash = readU64(view, PARAMS_SIZE + 8 * i);
      if (hash <= previous || hash >= theta) {
        throw new SerializationError(
          `theta: hash ${String(i)} is not strictly ascending in [1, theta)`,
        );
      }
      hashes[i] = hash;
      previous = hash;
    }
    try {
      return ThetaSketch.#sampled(k, seed, theta, hashes, count);
    } catch (err) {
      // A k the body agrees with can still be one the constructor refuses,
      // and a caller decoding a frame should see one error family.
      if (err instanceof ParamError) {
        throw new SerializationError(`theta: ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * Serializes the sketch's canonical sample to a portable little-endian
   * byte layout.
   *
   * @returns The serialized sketch, readable by {@link ThetaSketch.fromBytes}.
   */
  toBytes(): Uint8Array {
    const theta = this.#canonical();
    const count = this.retained;
    const sorted = this.#sorted;
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: HASH_MURMUR128 },
      PARAMS_SIZE,
      8 * count,
      (_, dv) => {
        dv.setUint32(0, this.#seed, true);
        dv.setUint32(4, this.#k, true);
        writeU64(dv, 8, theta);
        dv.setUint32(16, count, true);
        for (let i = 0; i < count; i++) {
          writeU64(dv, PARAMS_SIZE + 8 * i, sorted[i] ?? 0);
        }
      },
    );
  }

  /**
   * Serializes the sketch to a JSON-safe envelope wrapping
   * {@link ThetaSketch.toBytes}.
   *
   * @returns The envelope, readable by {@link ThetaSketch.fromJSON}.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }

  /**
   * Restores a sketch from its {@link ThetaSketch.toJSON} envelope.
   *
   * @param value - The parsed envelope.
   * @returns The reconstructed sketch.
   */
  static fromJSON(value: unknown): ThetaSketch {
    return ThetaSketch.fromBytes(fromJSONEnvelope(value));
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
    this.#settle();
    return this.#canonTheta / HASH_RANGE;
  }

  /** Hashes the estimate is computed from, at most `k`. */
  get retained(): number {
    return Math.min(this.#size, this.#k);
  }

  /** Whether no key has been added. */
  get isEmpty(): boolean {
    return this.#size === 0;
  }

  /** Whether `count()` estimates rather than counts. */
  get isEstimating(): boolean {
    return this.#size > this.#k || this.#theta < HASH_RANGE;
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
    this.#stale = true;
    const size = ++this.#size;
    if (table.length < 2 * this.#k) {
      if (size * 2 > table.length) this.#resize(table.length * 2);
    } else if (size * 4 > table.length * 3) {
      this.#rebuild();
    }
  }

  /**
   * Counts the distinct keys added: exact while not {@link isEstimating}.
   *
   * @returns The distinct count, or its estimate.
   */
  count(): number {
    return this.retained / this.theta;
  }

  /**
   * A lower bound on the distinct count, at `sd` standard deviations. Over
   * many sketches the two bounds together hold about as often as a normal
   * interval of that width: 68%, 95% and 99.7%.
   *
   * @param sd - Standard deviations: `1`, `2` or `3`.
   * @returns The bound; `count()` while exact.
   * @throws {@link ParamError} for any other `sd`.
   */
  lowerBound(sd: number): number {
    return thetaLowerBound(this.retained, this.theta, sd);
  }

  /**
   * An upper bound on the distinct count, at `sd` standard deviations. Over
   * many sketches the two bounds together hold about as often as a normal
   * interval of that width: 68%, 95% and 99.7%.
   *
   * @param sd - Standard deviations: `1`, `2` or `3`.
   * @returns The bound; `count()` while exact.
   * @throws {@link ParamError} for any other `sd`.
   */
  upperBound(sd: number): number {
    return thetaUpperBound(this.retained, this.theta, sd);
  }

  /**
   * Merges two sketches, giving a sketch of the keys either has seen. Both are
   * left untouched.
   *
   * The result keeps the smaller `k`, as HLL keeps the coarser precision:
   * with the larger, a union cut to a small `k` before a third sketch joins
   * would differ from one cut after, and grouping would change the answer.
   *
   * @param other - The sketch to merge with; must share this one's seed.
   * @returns A new sketch of the union, which takes keys and further operations.
   * @throws {@link ParamError} if the seeds differ, since the same key would
   * then hash differently on each side.
   */
  union(other: ThetaSketch): ThetaSketch {
    this.#assertSameSeed(other, "merge");
    let theta = Math.min(this.#canonical(), other.#canonical());
    const k = Math.min(this.#k, other.#k);
    const a = this.#sorted;
    const b = other.#sorted;
    const aEnd = this.retained;
    const bEnd = other.retained;
    const out = new Float64Array(Math.min(k, aEnd + bEnd));
    let i = 0;
    let j = 0;
    let count = 0;
    while (i < aEnd || j < bEnd) {
      const x = i < aEnd ? (a[i] ?? 0) : HASH_RANGE;
      const y = j < bEnd ? (b[j] ?? 0) : HASH_RANGE;
      const hash = x < y ? x : y;
      if (x === hash) i++;
      if (y === hash) j++;
      if (hash >= theta) break;
      if (count === k) {
        theta = hash;
        break;
      }
      out[count++] = hash;
    }
    return ThetaSketch.#sampled(k, this.#seed, theta, out, count);
  }

  /**
   * Intersects two sketches, giving a sketch of the keys both have seen. Both
   * are left untouched. Two disjoint sets read `0`, with an upper bound above
   * it: a sample cannot rule out a small overlap.
   *
   * @param other - The sketch to intersect with; must share this one's seed.
   * @returns A new sketch of the intersection, at the smaller `k`.
   * @throws {@link ParamError} if the seeds differ.
   */
  intersect(other: ThetaSketch): ThetaSketch {
    this.#assertSameSeed(other, "intersect");
    const theta = Math.min(this.#canonical(), other.#canonical());
    const k = Math.min(this.#k, other.#k);
    const a = this.#sorted;
    const b = other.#sorted;
    const aEnd = this.retained;
    const bEnd = other.retained;
    const out = new Float64Array(Math.min(aEnd, bEnd));
    let i = 0;
    let j = 0;
    let count = 0;
    while (i < aEnd && j < bEnd) {
      const x = a[i] ?? 0;
      const y = b[j] ?? 0;
      if (x >= theta || y >= theta) break;
      if (x < y) i++;
      else if (y < x) j++;
      else {
        out[count++] = x;
        i++;
        j++;
      }
    }
    return ThetaSketch.#sampled(k, this.#seed, theta, out, count);
  }

  /**
   * Subtracts a sketch from this one, giving a sketch of the keys this one has
   * seen and the other has not. Both are left untouched.
   *
   * @param other - The sketch to subtract; must share this one's seed.
   * @returns A new sketch of the difference, at the smaller `k`.
   * @throws {@link ParamError} if the seeds differ.
   */
  difference(other: ThetaSketch): ThetaSketch {
    this.#assertSameSeed(other, "subtract");
    let theta = Math.min(this.#canonical(), other.#canonical());
    const k = Math.min(this.#k, other.#k);
    const a = this.#sorted;
    const b = other.#sorted;
    const aEnd = this.retained;
    const bEnd = other.retained;
    const out = new Float64Array(Math.min(k, aEnd));
    let j = 0;
    let count = 0;
    for (let i = 0; i < aEnd; i++) {
      const x = a[i] ?? 0;
      if (x >= theta) break;
      while (j < bEnd && (b[j] ?? 0) < x) j++;
      if (j < bEnd && b[j] === x) continue;
      if (count === k) {
        theta = x;
        break;
      }
      out[count++] = x;
    }
    return ThetaSketch.#sampled(k, this.#seed, theta, out, count);
  }

  /**
   * Whether two sketches hold the same canonical sample at the same `k` and
   * seed. The order keys arrived in does not enter into it.
   *
   * @param other - The sketch to compare against.
   * @returns `true` if the two would answer every query identically.
   */
  equals(other: ThetaSketch): boolean {
    if (other.#k !== this.#k || other.#seed !== this.#seed) return false;
    const retained = this.retained;
    if (other.retained !== retained || other.theta !== this.theta) return false;
    const mine = this.#sorted;
    const theirs = other.#sorted;
    for (let i = 0; i < retained; i++) {
      if (mine[i] !== theirs[i]) return false;
    }
    return true;
  }

  #assertSameSeed(other: ThetaSketch, verb: string): void {
    if (other.#seed !== this.#seed) {
      throw new ParamError(
        `cannot ${verb} sketches with different seeds, got ${String(this.#seed)} and ${String(other.#seed)}`,
      );
    }
  }

  // Settles the canonical sample into the front of #sorted and returns its
  // theta, as a raw hash bound.
  #canonical(): number {
    this.#settle();
    return this.#canonTheta;
  }

  // A sketch holding exactly `hashes[0..count)` below `theta`. A set
  // operation keeps at most k hashes, so the table fits at half load.
  static #sampled(
    k: number,
    seed: number,
    theta: number,
    hashes: Float64Array,
    count: number,
  ): ThetaSketch {
    const sketch = new ThetaSketch({ k, seed });
    let capacity = MIN_CAPACITY;
    while (capacity < 2 * count) capacity *= 2;
    const table = new Float64Array(capacity);
    for (let i = 0; i < count; i++) place(table, hashes[i] ?? 0);
    sketch.#table = table;
    sketch.#size = count;
    sketch.#theta = theta;
    return sketch;
  }

  // Copies the live hashes to the front of #sorted, unordered.
  #gather(): Float64Array {
    if (this.#sorted.length < this.#size) {
      this.#sorted = new Float64Array(this.#size);
    }
    const sorted = this.#sorted;
    const table = this.#table;
    let at = 0;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- for...of is the allocation this avoids
    for (let i = 0; i < table.length; i++) {
      const hash = table[i] ?? 0;
      if (hash !== 0) sorted[at++] = hash;
    }
    return sorted;
  }

  #settle(): void {
    if (!this.#stale) return;
    const size = this.#size;
    const sorted = this.#gather();
    sorted.subarray(0, size).sort();
    this.#canonTheta =
      size > this.#k ? (sorted[this.#k] ?? HASH_RANGE) : this.#theta;
    this.#stale = false;
  }

  // Keeps the k smallest hashes and lowers theta to the (k+1)-th. The table
  // is refilled from #sorted, which needs no second buffer: once select() has
  // run, the k kept hashes sit at its front and nothing else is read from it.
  #rebuild(): void {
    const k = this.#k;
    const sorted = this.#gather();
    select(sorted, this.#size, k);
    this.#theta = sorted[k] ?? HASH_RANGE;
    const table = this.#table;
    table.fill(0);
    for (let i = 0; i < k; i++) place(table, sorted[i] ?? 0);
    this.#size = k;
    this.#stale = true;
  }

  #resize(capacity: number): void {
    const table = new Float64Array(capacity);
    const size = this.#size;
    const sorted = this.#gather();
    for (let i = 0; i < size; i++) place(table, sorted[i] ?? 0);
    this.#table = table;
  }
}

// Files a hash at the slot add() would pick: the low bits of a hash are its
// w0's, and the table's length is a power of two below 2^32.
function place(table: Float64Array, hash: number): void {
  const mask = table.length - 1;
  let slot = hash % table.length;
  while (table[slot] !== 0) slot = (slot + 1) & mask;
  table[slot] = hash;
}

// Rearranges a[0..n) so that a[k] holds the value of rank k, with smaller
// values before it and larger after: Wirth's selection, median-of-three pivot.
function select(a: Float64Array, n: number, k: number): void {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const x = a[lo] ?? 0;
    const y = a[mid] ?? 0;
    const z = a[hi] ?? 0;
    const pivot =
      x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while ((a[i] ?? 0) < pivot) i++;
      while ((a[j] ?? 0) > pivot) j--;
      if (i <= j) {
        const t = a[i] ?? 0;
        a[i++] = a[j] ?? 0;
        a[j--] = t;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

// A hash or theta, an integer of at most 53 bits, as a u64. ToUint32 takes the
// value mod 2^32, so `>>> 0` is the low word even above 2^32.
function writeU64(dv: DataView, at: number, value: number): void {
  dv.setUint32(at, value >>> 0, true);
  dv.setUint32(at + 4, Math.floor(value / 2 ** 32), true);
}

function readU64(view: DataView, at: number): number {
  return view.getUint32(at + 4, true) * 2 ** 32 + view.getUint32(at, true);
}
