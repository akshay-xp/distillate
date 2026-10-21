import { assertUint32, ParamError } from "../core/params.js";
import {
  assertBodyLength,
  assertMinBodyLength,
  assertParamsPadding,
  bytesEqual,
  type FilterJSON,
  FORMAT_VERSION,
  fromJSONEnvelope,
  readHeader,
  SerializationError,
  toJSONEnvelope,
  UnknownHashVariantError,
  writeFrame,
} from "../core/serialize.js";
import { mix, nextState } from "./random.js";
import { KLL_MAX_K, KLL_MIN_K, kllRankError, kllSizing } from "./sizing.js";

// No level holds fewer than this many items, however deep below the top.
const MIN_LEVEL_CAPACITY = 8;

/** DSTL frame type for a KLL sketch. */
const TYPE = 14;
// KLL compares values and hashes nothing, so its hash variant is 0.
const NO_HASH = 0;
const ITEM_F64 = 0;
const FLAG_SEEDED = 1;
// Weights reach 2^53 by level 53, past which n is no longer a safe integer.
const MAX_LEVELS = 64;

/**
 * Body layout: item type (u8, 0 = f64) | flags (u8, bit 0 seeded) | k (u16) |
 * generator state (u32) | n (u64) | min (f64) | max (f64) | L (u32) | items
 * per level (u32 x L, level 0 first) | zero padding to a multiple of 8 | items
 * (f64), level 0 first, each level in held order: level 0 unsorted, newest
 * first with a compaction's odd item out at its end, the rest ascending. All
 * little-endian.
 */
const LEVEL_SIZES_AT = 36;
const paramsSize = (numLevels: number): number =>
  Math.ceil((LEVEL_SIZES_AT + 4 * numLevels) / 8) * 8;

/** Construction parameters for a {@link KllSketch}. */
export interface KllParams {
  /** Items the top level holds, an integer in [8, 65535]; defaults to `200`. */
  k?: number;
  /**
   * Seed for the coin flips compaction makes. Give one to make a stream's
   * sketch reproducible; without one, a random seed is drawn.
   */
  seed?: number;
}

/**
 * A KLL sketch: quantiles and ranks of a stream of numbers, each within a
 * rank error of about `1.3%` at the default `k`, in memory fixed by `k`.
 *
 * @example
 * ```ts
 * const latency = KllSketch.create(0.01);
 * latency.add(12.5);
 * ```
 */
export class KllSketch {
  readonly #k: number;
  // Level h occupies #items[#levels[h], #levels[h + 1]); an item there stands
  // for 2^h values of the stream. Level 0 grows downward into the free space
  // at the front, so the sketch is full when #levels[0] reaches 0.
  #items: Float64Array;
  #levels: number[];
  #n = 0;
  #min = Number.NaN;
  #max = Number.NaN;
  // The coin-flip generator's state, drawn at the first compaction when no
  // seed was given.
  #state = 0;
  #seeded: boolean;

  /**
   * Creates a sketch at an explicit `k`.
   *
   * @param params - Accuracy and optional seed.
   */
  constructor({ k = 200, seed }: KllParams = {}) {
    if (!Number.isInteger(k) || k < KLL_MIN_K || k > KLL_MAX_K) {
      throw new ParamError(
        `k must be an integer in [${String(KLL_MIN_K)}, ${String(KLL_MAX_K)}], got ${String(k)}`,
      );
    }
    if (seed !== undefined) assertUint32(seed, "seed");
    this.#k = k;
    this.#items = new Float64Array(k);
    this.#levels = [k, k];
    this.#seeded = seed !== undefined;
    this.#state = seed ?? 0;
  }

  /**
   * Creates a sketch whose single-rank error meets `rankError`.
   *
   * @param rankError - Target normalized rank error, e.g. `0.01` for 1%.
   * @returns A new, empty sketch.
   */
  static create(rankError: number): KllSketch {
    return new KllSketch(kllSizing(rankError));
  }

  /**
   * Restores a sketch from {@link KllSketch.toBytes}. It goes on taking values
   * and flipping the coins the sketch that wrote it would have.
   *
   * @param bytes - The serialized sketch.
   * @returns The reconstructed sketch.
   * @throws {@link SerializationError} when the frame is malformed or not a
   * KLL sketch.
   */
  static fromBytes(bytes: Uint8Array): KllSketch {
    const { type, flags, body } = readHeader(bytes);
    if (type !== TYPE) {
      throw new SerializationError(
        `expected DSTL type ${String(TYPE)}, got ${String(type)}`,
      );
    }
    if ((flags & 0x0f) !== NO_HASH) {
      throw new UnknownHashVariantError(
        `kll hashes nothing, so its hash variant must be 0, got ${String(flags & 0x0f)}`,
      );
    }
    assertMinBodyLength(body.length, LEVEL_SIZES_AT, "kll");
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const numLevels = view.getUint32(32, true);
    if (numLevels < 1 || numLevels > MAX_LEVELS) {
      throw invalid(
        `${String(numLevels)} levels is outside [1, ${String(MAX_LEVELS)}]`,
      );
    }
    const payload = paramsSize(numLevels);
    assertMinBodyLength(body.length, payload, "kll");
    const sizes = Array.from({ length: numLevels }, (_, h) =>
      view.getUint32(LEVEL_SIZES_AT + 4 * h, true),
    );
    const retained = sizes.reduce((a, b) => a + b, 0);
    assertBodyLength(body.length, payload + 8 * retained, "kll");
    assertParamsPadding(body, LEVEL_SIZES_AT + 4 * numLevels, payload, "kll");

    if (view.getUint8(0) !== ITEM_F64) {
      throw invalid(`unknown item type ${String(view.getUint8(0))}`);
    }
    const flagByte = view.getUint8(1);
    if ((flagByte & ~FLAG_SEEDED) !== 0) {
      throw invalid(`reserved flag bits set in ${String(flagByte)}`);
    }
    const seeded = flagByte === FLAG_SEEDED;
    const state = view.getUint32(4, true);
    if (!seeded && state !== 0) {
      throw invalid("an unseeded sketch carries a generator state");
    }
    const k = view.getUint16(2, true);
    let sketch: KllSketch;
    try {
      sketch = new KllSketch({ k });
    } catch (err) {
      // A k the body agrees with can still be one the constructor refuses,
      // and a caller decoding a frame should see one error family.
      if (err instanceof ParamError) throw invalid(err.message);
      throw err;
    }
    const n = view.getUint32(12, true) * 2 ** 32 + view.getUint32(8, true);
    // Compaction turns 2m items of weight w into m of weight 2w, so the
    // weights always sum to n exactly.
    const weight = sizes.reduce((sum, size, h) => sum + size * 2 ** h, 0);
    if (!Number.isSafeInteger(n) || weight !== n) {
      throw invalid(`n ${String(n)} disagrees with the level weights`);
    }
    const total = totalCapacity(k, numLevels);
    if (retained > total) {
      throw invalid(`${String(retained)} items exceed the capacity at k`);
    }
    const min = view.getFloat64(16, true);
    const max = view.getFloat64(24, true);
    if (n === 0 ? !(Number.isNaN(min) && Number.isNaN(max)) : !(min <= max)) {
      throw invalid(
        `min ${String(min)} and max ${String(max)} are inconsistent`,
      );
    }

    const items = new Float64Array(total);
    const levels = [total - retained];
    let at = 0;
    for (let h = 0; h < numLevels; h++) {
      const base = levels[h] ?? 0;
      let previous = -Infinity;
      for (let i = 0; i < (sizes[h] ?? 0); i++, at++) {
        const item = view.getFloat64(payload + 8 * at, true);
        if (!(item >= min && item <= max)) {
          throw invalid(`item ${String(at)} is NaN or outside [min, max]`);
        }
        // Every level but 0 is held in ascending order.
        if (h > 0 && item < previous) {
          throw invalid(`level ${String(h)} is not ascending`);
        }
        previous = item;
        items[base + i] = item;
      }
      levels.push(base + (sizes[h] ?? 0));
    }
    sketch.#seeded = seeded;
    sketch.#state = state;
    sketch.#n = n;
    sketch.#min = min;
    sketch.#max = max;
    sketch.#items = items;
    sketch.#levels = levels;
    return sketch;
  }

  /**
   * Serializes the sketch, generator state included, to a portable
   * little-endian byte layout.
   *
   * @returns The serialized sketch, readable by {@link KllSketch.fromBytes}.
   */
  toBytes(): Uint8Array {
    const numLevels = this.numLevels;
    const params = paramsSize(numLevels);
    const front = this.#levels[0] ?? 0;
    const retained = this.retained;
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: NO_HASH },
      params,
      8 * retained,
      (_, view) => {
        view.setUint8(0, ITEM_F64);
        view.setUint8(1, this.#seeded ? FLAG_SEEDED : 0);
        view.setUint16(2, this.#k, true);
        view.setUint32(4, this.#state, true);
        view.setUint32(8, this.#n >>> 0, true);
        view.setUint32(12, Math.floor(this.#n / 2 ** 32), true);
        view.setFloat64(16, this.#min, true);
        view.setFloat64(24, this.#max, true);
        view.setUint32(32, numLevels, true);
        for (let h = 0; h < numLevels; h++) {
          const size = (this.#levels[h + 1] ?? 0) - (this.#levels[h] ?? 0);
          view.setUint32(LEVEL_SIZES_AT + 4 * h, size, true);
        }
        for (let i = 0; i < retained; i++) {
          view.setFloat64(params + 8 * i, this.#items[front + i] ?? 0, true);
        }
      },
    );
  }

  /**
   * Tests structural equality: `true` when `other` serializes to identical
   * bytes, meaning the same `k`, generator state, counts and items.
   *
   * @param other - The sketch to compare against.
   * @returns `true` if the two sketches are byte-for-byte identical.
   */
  equals(other: KllSketch): boolean {
    return bytesEqual(this.toBytes(), other.toBytes());
  }

  /**
   * Serializes the sketch to a JSON-safe envelope wrapping
   * {@link KllSketch.toBytes}.
   *
   * @returns The envelope, readable by {@link KllSketch.fromJSON}.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }

  /**
   * Restores a sketch from its {@link KllSketch.toJSON} envelope.
   *
   * @param value - The parsed envelope.
   * @returns The reconstructed sketch.
   */
  static fromJSON(value: unknown): KllSketch {
    return KllSketch.fromBytes(fromJSONEnvelope(value));
  }

  /** Items the top level holds. */
  get k(): number {
    return this.#k;
  }

  /** Values recorded, weights included. */
  get count(): number {
    return this.#n;
  }

  /** Whether no value has been recorded. */
  get isEmpty(): boolean {
    return this.#n === 0;
  }

  /** Items the sketch holds. */
  get retained(): number {
    return (this.#levels.at(-1) ?? 0) - (this.#levels[0] ?? 0);
  }

  /** Levels of compaction, `1` until the first. */
  get numLevels(): number {
    return this.#levels.length - 1;
  }

  /** The smallest value recorded, exactly; `NaN` while empty. */
  get min(): number {
    return this.#min;
  }

  /** The largest value recorded, exactly; `NaN` while empty. */
  get max(): number {
    return this.#max;
  }

  /**
   * Rank error at 99% confidence, as a fraction of `count`.
   *
   * @param pmf - `true` for the error over every rank of a CDF or PMF at
   * once, `false` (the default) for a single rank or quantile.
   * @returns The normalized rank error.
   */
  normalizedRankError(pmf = false): number {
    return kllRankError(this.#k, pmf);
  }

  /**
   * The value at quantile `q`: the item at rank `floor(q * (count - 1))` of
   * the stream, within the rank error. `q = 0` and `q = 1` give `min` and
   * `max` exactly.
   *
   * @param q - The quantile, in `[0, 1]`.
   * @returns The estimate, or `NaN` when the sketch is empty.
   * @throws {@link ParamError} when `q` is outside `[0, 1]`.
   */
  quantile(q: number): number {
    return this.quantiles([q])[0] ?? Number.NaN;
  }

  /** {@link KllSketch.quantile} for each of `qs`, in order. */
  quantiles(qs: readonly number[]): number[] {
    for (const q of qs) {
      if (!(q >= 0 && q <= 1)) {
        throw new ParamError(`q must be in [0, 1], got ${String(q)}`);
      }
    }
    // Sorting the items is the whole cost of a query, so the qs share a view.
    let view: { items: Float64Array; cumulative: Float64Array } | undefined;
    return qs.map((q) => {
      if (this.#n === 0) return Number.NaN;
      if (q === 0) return this.#min;
      if (q === 1) return this.#max;
      const { items, cumulative } = (view ??= this.#sortedView());
      const rank = Math.floor(q * (this.#n - 1));
      let lo = 0;
      let hi = cumulative.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((cumulative[mid] ?? 0) <= rank) lo = mid + 1;
        else hi = mid;
      }
      return items[lo] ?? this.#max;
    });
  }

  /**
   * The fraction of the stream at or below `x`, within the rank error.
   *
   * @param x - Any number but `NaN`.
   * @returns The rank in `[0, 1]`, or `NaN` when the sketch is empty.
   */
  rank(x: number): number {
    if (Number.isNaN(x)) throw new ParamError("x must not be NaN");
    if (this.#n === 0) return Number.NaN;
    const items = this.#items;
    const levels = this.#levels;
    let atOrBelow = 0;
    for (let i = levels[0] ?? 0; i < (levels[1] ?? 0); i++) {
      if ((items[i] ?? 0) <= x) atOrBelow++;
    }
    // Levels above 0 are sorted: a binary search finds the first item past x.
    for (let h = 1; h + 1 < levels.length; h++) {
      const beg = levels[h] ?? 0;
      let lo = beg;
      let hi = levels[h + 1] ?? 0;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((items[mid] ?? 0) <= x) lo = mid + 1;
        else hi = mid;
      }
      atOrBelow += (lo - beg) * 2 ** h;
    }
    return atOrBelow / this.#n;
  }

  /**
   * The cumulative distribution at `splits`: the fraction of the stream at or
   * below each, then `1` for everything, each within the rank error.
   *
   * @param splits - Strictly increasing numbers, none `NaN`.
   * @returns `splits.length + 1` fractions; all `NaN` while empty.
   * @throws {@link ParamError} when `splits` are not strictly increasing or
   * hold `NaN`.
   */
  cdf(splits: readonly number[]): number[] {
    splits.forEach((split, i) => {
      if (Number.isNaN(split) || (i > 0 && !(split > (splits[i - 1] ?? 0)))) {
        throw new ParamError(
          `splits must be strictly increasing and not NaN, got ${String(splits)}`,
        );
      }
    });
    if (this.#n === 0) return [...splits, 0].map(() => Number.NaN);
    return [...splits.map((split) => this.rank(split)), 1];
  }

  /**
   * The mass between `splits`: the fraction of the stream at or below the
   * first, then in each interval up to the next, then above the last.
   *
   * @param splits - Strictly increasing numbers, none `NaN`.
   * @returns `splits.length + 1` fractions summing to `1`; all `NaN` while
   * empty.
   * @throws {@link ParamError} as {@link KllSketch.cdf} does.
   */
  pmf(splits: readonly number[]): number[] {
    const cdf = this.cdf(splits);
    return cdf.map((c, i) => c - (i === 0 ? 0 : (cdf[i - 1] ?? 0)));
  }

  /**
   * Merges two sketches into a new one that answers as a single sketch fed
   * both streams would, within the rank error. Both are left untouched.
   *
   * The result keeps the smaller `k`, as HyperLogLog keeps the coarser
   * precision, so a coarse sketch merged with a fine one has the coarse one's
   * accuracy.
   *
   * @param other - The sketch to merge with.
   * @returns A new sketch of both streams, which takes values and further
   * unions.
   * @throws {@link ParamError} when the merged count would pass
   * `Number.MAX_SAFE_INTEGER`.
   */
  union(other: KllSketch): KllSketch {
    assertSafeTotal(this.#n + other.#n);
    const result = new KllSketch({ k: Math.min(this.#k, other.#k) });
    // A state of its own, so the result does not replay either input's coins.
    if (this.#seeded && other.#seeded) {
      result.#state = mix(this.#state ^ mix(other.#state));
      result.#seeded = true;
    }
    result.#n = this.#n + other.#n;
    // An empty side's min and max are NaN, which Math.min would carry.
    if (this.#n === 0 || other.#n === 0) {
      const full = this.#n === 0 ? other : this;
      result.#min = full.#min;
      result.#max = full.#max;
    } else {
      result.#min = Math.min(this.#min, other.#min);
      result.#max = Math.max(this.#max, other.#max);
    }

    // Level by level: the two level 0s side by side, each higher level the
    // two sorted runs merged. The result holds them at the back of a buffer
    // of its full capacity, the free space in front, as add() keeps it.
    const numLevels = Math.max(this.numLevels, other.numLevels);
    const total = Math.max(
      this.retained + other.retained,
      totalCapacity(result.#k, numLevels),
    );
    const items = new Float64Array(total);
    const levels = new Array<number>(numLevels + 1).fill(total);
    let end = total;
    for (let h = numLevels - 1; h >= 0; h--) {
      const a = this.#level(h);
      const b = other.#level(h);
      const beg = end - a.length - b.length;
      if (h === 0) {
        items.set(a, beg);
        items.set(b, beg + a.length);
      } else {
        mergeInto(items, beg, a, b);
      }
      levels[h] = beg;
      end = beg;
    }
    result.#items = items;
    result.#levels = levels;
    result.#compress();
    return result;
  }

  // Level h's items, empty past the top.
  #level(h: number): Float64Array {
    if (h + 1 >= this.#levels.length) return new Float64Array(0);
    return this.#items.subarray(this.#levels[h], this.#levels[h + 1]);
  }

  /**
   * Records a value.
   *
   * @param value - Any number but `NaN`; infinities and `-0` are ordered as
   * numbers.
   * @param count - How many times to record it; a positive safe integer.
   * @throws {@link ParamError} when `value` is `NaN`, `count` is not a
   * positive safe integer, or the count would pass `Number.MAX_SAFE_INTEGER`.
   * Nothing is recorded.
   */
  add(value: number, count = 1): void {
    if (Number.isNaN(value)) throw new ParamError("value must not be NaN");
    assertSafeTotal(this.#n + count);
    if (count === 1) {
      if (this.#levels[0] === 0) this.#compact();
      const at = (this.#levels[0] ?? 0) - 1;
      this.#items[at] = value;
      this.#levels[0] = at;
    } else {
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new ParamError(
          `count must be a positive safe integer, got ${String(count)}`,
        );
      }
      // One item per set bit: bit h of count is 2^h values, which is what an
      // item at level h stands for.
      for (
        let h = 0, rest = count;
        rest > 0;
        h++, rest = Math.floor(rest / 2)
      ) {
        if (rest % 2 === 1) this.#insert(value, h);
      }
    }
    this.#n += count;
    if (!(value >= this.#min)) this.#min = value;
    if (!(value <= this.#max)) this.#max = value;
  }

  // Places value in level h at its sorted position, adding levels up to h.
  // Everything in front of that position moves one slot into the free space.
  #insert(value: number, h: number): void {
    while (this.numLevels <= h) this.#addTopLevel();
    if (this.#levels[0] === 0) this.#compact();
    const levels = this.#levels;
    const items = this.#items;
    let at = levels[h] ?? 0;
    const end = levels[h + 1] ?? 0;
    // Level 0 is unsorted, so anywhere in it will do.
    if (h > 0) while (at < end && (items[at] ?? 0) < value) at++;
    const front = levels[0] ?? 0;
    items.copyWithin(front - 1, front, at);
    items[at - 1] = value;
    for (let i = 0; i <= h; i++) levels[i] = (levels[i] ?? 0) - 1;
  }

  // Halves the lowest level at or over its capacity into the level above,
  // freeing space at the front of #items. Called only when it is full.
  #compact(): void {
    this.#compactLevel(this.#lowestFullLevel());
  }

  // Compacts until the items fit the capacity at this k, then moves them into
  // a buffer of exactly that size, as add() expects. A union starts over it.
  #compress(): void {
    while (this.retained > totalCapacity(this.#k, this.numLevels)) {
      this.#compactLevel(this.#lowestFullLevel());
    }
    const total = totalCapacity(this.#k, this.numLevels);
    const front = this.#levels[0] ?? 0;
    const shift = total - this.#items.length;
    const items = new Float64Array(total);
    items.set(this.#items.subarray(front), front + shift);
    this.#items = items;
    this.#levels = this.#levels.map((at) => at + shift);
  }

  // The lowest level at or over its capacity, or the top if none is.
  #lowestFullLevel(): number {
    let h = 0;
    for (; h + 1 < this.numLevels; h++) {
      const size = (this.#levels[h + 1] ?? 0) - (this.#levels[h] ?? 0);
      if (size >= levelCapacity(this.#k, this.numLevels, h)) break;
    }
    return h;
  }

  // Halves level h into the level above, adding a level when h is the top.
  #compactLevel(h: number): void {
    if (h + 1 === this.numLevels) this.#addTopLevel();
    const items = this.#items;
    const levels = this.#levels;
    const rawBeg = levels[h] ?? 0;
    const rawEnd = levels[h + 1] ?? 0;
    const popAbove = (levels[h + 2] ?? 0) - rawEnd;
    const odd = (rawEnd - rawBeg) % 2;
    // An odd item out stays behind at level h.
    const adjBeg = rawBeg + odd;
    const half = (rawEnd - adjBeg) / 2;
    if (h === 0) sortRange(items, adjBeg, rawEnd);

    // Keep every second item from a random offset, packed to the front of
    // the range, then merge them with level h + 1. The merge writes from
    // adjBeg + half, never past an item of either run it has yet to read.
    const offset = this.#coin();
    for (let i = 0; i < half; i++) {
      items[adjBeg + i] = items[adjBeg + 2 * i + offset] ?? 0;
    }
    let a = adjBeg;
    let b = rawEnd;
    const aEnd = adjBeg + half;
    const bEnd = rawEnd + popAbove;
    for (let c = aEnd; c < bEnd; c++) {
      if (b >= bEnd || (a < aEnd && (items[a] ?? 0) <= (items[b] ?? 0))) {
        items[c] = items[a++] ?? 0;
      } else {
        items[c] = items[b++] ?? 0;
      }
    }

    levels[h + 1] = aEnd;
    if (odd === 1) items[aEnd - 1] = items[rawBeg] ?? 0;
    levels[h] = aEnd - odd;
    // The levels below h move up into the space the halving freed.
    const front = levels[0] ?? 0;
    if (h > 0) {
      items.copyWithin(front + half, front, rawBeg);
      for (let i = 0; i < h; i++) levels[i] = (levels[i] ?? 0) + half;
    }
  }

  // Adds an empty level on top. Capacities shift down a level, so #items
  // grows to the new total, with the free space at the front.
  #addTopLevel(): void {
    const levels = this.#levels;
    levels.push(levels.at(-1) ?? 0);
    const total = totalCapacity(this.#k, this.numLevels);
    const grow = total - this.#items.length;
    // A union's buffer can already be larger; #compress() trims it after.
    if (grow <= 0) return;
    const items = new Float64Array(total);
    items.set(this.#items, grow);
    this.#items = items;
    for (let i = 0; i < levels.length; i++) levels[i] = (levels[i] ?? 0) + grow;
  }

  // A fair 0 or 1 from the seeded generator.
  #coin(): number {
    if (!this.#seeded) {
      // Drawn here rather than in the constructor: Cloudflare Workers refuse
      // random values at module scope, where a sketch is commonly created.
      this.#state = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
      this.#seeded = true;
    }
    this.#state = nextState(this.#state);
    return mix(this.#state) >>> 31;
  }

  // Every item in ascending order, with the stream weight at or below it.
  #sortedView(): { items: Float64Array; cumulative: Float64Array } {
    const levels = this.#levels;
    const start = levels[0] ?? 0;
    const retained = this.retained;
    const order = Array.from({ length: retained }, (_, i) => start + i);
    const source = this.#items;
    order.sort((a, b) => (source[a] ?? 0) - (source[b] ?? 0));
    const items = new Float64Array(retained);
    const cumulative = new Float64Array(retained);
    let total = 0;
    for (let i = 0; i < retained; i++) {
      const at = order[i] ?? 0;
      let h = 0;
      while ((levels[h + 1] ?? 0) <= at) h++;
      total += 2 ** h;
      items[i] = source[at] ?? 0;
      cumulative[i] = total;
    }
    return { items, cumulative };
  }
}

// Items level h of numLevels may hold: k at the top, shrinking by 2/3 per
// level below it, never under MIN_LEVEL_CAPACITY.
function levelCapacity(k: number, numLevels: number, h: number): number {
  const depth = numLevels - h - 1;
  return Math.max(MIN_LEVEL_CAPACITY, Math.ceil(k * (2 / 3) ** depth));
}

function totalCapacity(k: number, numLevels: number): number {
  let total = 0;
  for (let h = 0; h < numLevels; h++) total += levelCapacity(k, numLevels, h);
  return total;
}

// Sorts a[lo, hi) ascending in place. A subarray view and its sort() would do
// the same, but the view is an allocation per compaction.
function sortRange(a: Float64Array, lo: number, hi: number): void {
  while (hi - lo > 16) {
    // Median of three to the middle, then a Hoare partition around it.
    const mid = (lo + hi) >>> 1;
    const last = hi - 1;
    if ((a[mid] ?? 0) < (a[lo] ?? 0)) swap(a, mid, lo);
    if ((a[last] ?? 0) < (a[lo] ?? 0)) swap(a, last, lo);
    if ((a[last] ?? 0) < (a[mid] ?? 0)) swap(a, last, mid);
    const pivot = a[mid] ?? 0;
    let i = lo;
    let j = last;
    for (;;) {
      while ((a[i] ?? 0) < pivot) i++;
      while ((a[j] ?? 0) > pivot) j--;
      if (i >= j) break;
      swap(a, i++, j--);
    }
    // Recurse into the smaller side, loop on the larger: stack depth stays
    // logarithmic.
    if (j + 1 - lo < hi - (j + 1)) {
      sortRange(a, lo, j + 1);
      lo = j + 1;
    } else {
      sortRange(a, j + 1, hi);
      hi = j + 1;
    }
  }
  for (let i = lo + 1; i < hi; i++) {
    const v = a[i] ?? 0;
    let j = i - 1;
    while (j >= lo && (a[j] ?? 0) > v) {
      a[j + 1] = a[j] ?? 0;
      j--;
    }
    a[j + 1] = v;
  }
}

function swap(a: Float64Array, i: number, j: number): void {
  const t = a[i] ?? 0;
  a[i] = a[j] ?? 0;
  a[j] = t;
}

// Writes the merge of sorted runs a and b to out from index at.
function mergeInto(
  out: Float64Array,
  at: number,
  a: Float64Array,
  b: Float64Array,
): void {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && (a[i] ?? 0) <= (b[j] ?? 0))) {
      out[at++] = a[i++] ?? 0;
    } else {
      out[at++] = b[j++] ?? 0;
    }
  }
}

// Past 2^53 - 1 the count loses precision and fromBytes refuses it, so the
// sketch would write a frame its own reader rejects.
function assertSafeTotal(total: number): void {
  if (total > Number.MAX_SAFE_INTEGER) {
    throw new ParamError(
      `the count would pass ${String(Number.MAX_SAFE_INTEGER)}`,
    );
  }
}

function invalid(message: string): SerializationError {
  return new SerializationError(`kll: ${message}`);
}
