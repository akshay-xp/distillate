import { assertUint32, ParamError } from "../core/params.js";
import { mix, nextState } from "./random.js";
import { KLL_MAX_K, KLL_MIN_K, kllRankError, kllSizing } from "./sizing.js";

// No level holds fewer than this many items, however deep below the top.
const MIN_LEVEL_CAPACITY = 8;

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
    if (!(q >= 0 && q <= 1)) {
      throw new ParamError(`q must be in [0, 1], got ${String(q)}`);
    }
    if (this.#n === 0) return Number.NaN;
    if (q === 0) return this.#min;
    if (q === 1) return this.#max;
    const rank = Math.floor(q * (this.#n - 1));
    const { items, cumulative } = this.#sortedView();
    let i = 0;
    while ((cumulative[i] ?? 0) <= rank) i++;
    return items[i] ?? this.#max;
  }

  /** {@link KllSketch.quantile} for each of `qs`, in order. */
  quantiles(qs: readonly number[]): number[] {
    return qs.map((q) => this.quantile(q));
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
   * Records a value.
   *
   * @param value - Any number but `NaN`; infinities and `-0` are ordered as
   * numbers.
   * @param count - How many times to record it; a positive safe integer.
   * @throws {@link ParamError} when `value` is `NaN` or `count` is not a
   * positive safe integer. Nothing is recorded.
   */
  add(value: number, count = 1): void {
    if (Number.isNaN(value)) throw new ParamError("value must not be NaN");
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
    const k = this.#k;
    let h = 0;
    for (; h + 1 < this.numLevels; h++) {
      const size = (this.#levels[h + 1] ?? 0) - (this.#levels[h] ?? 0);
      if (size >= levelCapacity(k, this.numLevels, h)) break;
    }
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
    if (h === 0) items.subarray(adjBeg, rawEnd).sort();

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
