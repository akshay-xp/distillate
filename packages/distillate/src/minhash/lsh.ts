import { fmix32 } from "../core/hasher.js";
import { assertUint32, ParamError } from "../core/params.js";
import { denseSlots, type MinHash } from "./minhash.js";
import { lshSizing } from "./sizing.js";

const HI_MASK = 0x1fffff;
const TWO_32 = 2 ** 32;
// Most buckets hold one key, where an array costs well under half a Set, so a
// bucket grows into a Set only past this size: removal never scans more.
const SMALL_BUCKET = 16;

type Bucket<K> = K[] | Set<K>;

/** Construction parameters for a {@link MinHashLSH} index. */
export interface MinHashLSHParams {
  /** Jaccard similarity that should make a pair a candidate. */
  threshold: number;
  /** Slots in every sketch the index takes; defaults to `128`. */
  k?: number;
  /**
   * Cost of a false positive and of a false negative when choosing bands and
   * rows; sum to 1. Defaults to `[0.5, 0.5]`.
   */
  weights?: readonly [number, number];
  /** Hash seed every sketch the index takes must share; defaults to `0`. */
  seed?: number;
}

/**
 * A banded locality-sensitive hashing index over {@link MinHash} signatures:
 * finds the stored keys whose sets are likely at least `threshold` similar to
 * a query, without comparing against every one.
 *
 * @example
 * ```ts
 * const lsh = new MinHashLSH<string>({ threshold: 0.8 });
 * lsh.insert("doc-1", MinHash.from(shingles, 0.05));
 * ```
 */
export class MinHashLSH<K> {
  readonly #threshold: number;
  readonly #k: number;
  readonly #seed: number;
  readonly #bands: number;
  readonly #rows: number;
  // One bucket map per band, from band key to the keys filed under it.
  readonly #buckets: Map<number, Bucket<K>>[];
  // Each stored key with the band keys it was filed under.
  readonly #entries = new Map<K, Float64Array>();

  /**
   * Creates an empty index, choosing bands and rows with `lshSizing`.
   *
   * @param params - Threshold, slot count, weights and seed.
   */
  constructor({ threshold, k = 128, weights, seed = 0 }: MinHashLSHParams) {
    const { bands, rows } = lshSizing(threshold, k, weights);
    assertUint32(seed, "seed");
    this.#threshold = threshold;
    this.#k = k;
    this.#seed = seed;
    this.#bands = bands;
    this.#rows = rows;
    this.#buckets = Array.from(
      { length: bands },
      () => new Map<number, Bucket<K>>(),
    );
  }

  /**
   * Files a sketch under `key`, so later queries similar to it find `key`.
   *
   * @param key - The key to store; must not already be stored.
   * @param sketch - The key's set, sketched with this index's `k` and seed.
   * @throws {@link ParamError} on a duplicate key or a sketch whose `k` or
   * seed differs from the index's.
   */
  insert(key: K, sketch: MinHash): void {
    if (this.#entries.has(key)) {
      throw new ParamError(`key ${String(key)} is already in the index`);
    }
    const bandKeys = this.#bandKeys(sketch);
    for (let band = 0; band < bandKeys.length; band++) {
      const buckets = this.#buckets[band];
      const bandKey = bandKeys[band] ?? 0;
      const bucket = buckets?.get(bandKey);
      if (!bucket) buckets?.set(bandKey, [key]);
      else if (!Array.isArray(bucket)) bucket.add(key);
      else if (bucket.length < SMALL_BUCKET) bucket.push(key);
      else buckets?.set(bandKey, new Set([...bucket, key]));
    }
    this.#entries.set(key, bandKeys);
  }

  /**
   * Finds the stored keys sharing at least one band with `sketch`: likely, not
   * certainly, at least `threshold` similar. Confirm with
   * {@link MinHash.jaccard} where it matters.
   *
   * @param sketch - The set to look up.
   * @returns Each candidate key once, in no particular order.
   * @throws {@link ParamError} if the sketch's `k` or seed differs.
   */
  query(sketch: MinHash): K[] {
    const bandKeys = this.#bandKeys(sketch);
    const found = new Set<K>();
    for (let band = 0; band < bandKeys.length; band++) {
      const bucket = this.#buckets[band]?.get(bandKeys[band] ?? 0);
      if (bucket) for (const key of bucket) found.add(key);
    }
    return [...found];
  }

  /**
   * Unfiles `key` from every band.
   *
   * @param key - The key to remove.
   * @returns `true` if the key was stored.
   */
  remove(key: K): boolean {
    const bandKeys = this.#entries.get(key);
    if (!bandKeys) return false;
    for (let band = 0; band < bandKeys.length; band++) {
      const buckets = this.#buckets[band];
      const bandKey = bandKeys[band] ?? 0;
      const bucket = buckets?.get(bandKey);
      if (!bucket) continue;
      if (Array.isArray(bucket)) {
        // Swap-remove: keys come back in no particular order anyway.
        const last = bucket.pop() as K;
        const at = bucket.indexOf(key);
        if (at !== -1) bucket[at] = last;
        if (bucket.length === 0) buckets?.delete(bandKey);
      } else {
        bucket.delete(key);
        if (bucket.size === 0) buckets?.delete(bandKey);
      }
    }
    this.#entries.delete(key);
    return true;
  }

  /**
   * Whether `key` is stored.
   *
   * @param key - The key to look for.
   */
  has(key: K): boolean {
    return this.#entries.has(key);
  }

  // One 53-bit key per band, from two fmix32 accumulators over the band's
  // densified slots. Two keys colliding only adds a candidate, never loses one.
  #bandKeys(sketch: MinHash): Float64Array {
    if (sketch.k !== this.#k || sketch.seed !== this.#seed) {
      throw new ParamError(
        `sketch has k ${String(sketch.k)} and seed ${String(sketch.seed)}, the index takes k ${String(this.#k)} and seed ${String(this.#seed)}`,
      );
    }
    const slots = denseSlots(sketch);
    const rows = this.#rows;
    const out = new Float64Array(this.#bands);
    for (let band = 0; band < out.length; band++) {
      let lo = band;
      let hi = (band ^ 0x85ebca6b) >>> 0;
      for (let r = band * rows; r < (band + 1) * rows; r++) {
        const value = slots[r] ?? 0;
        lo = fmix32((lo ^ value) >>> 0);
        hi = fmix32((hi + value) >>> 0);
      }
      out[band] = (hi & HI_MASK) * TWO_32 + lo;
    }
    return out;
  }

  /** Similarity the index was tuned for. */
  get threshold(): number {
    return this.#threshold;
  }

  /** Slots in every sketch the index takes. */
  get k(): number {
    return this.#k;
  }

  /** Hash seed every sketch the index takes must share. */
  get seed(): number {
    return this.#seed;
  }

  /** Bands each signature is cut into. */
  get bands(): number {
    return this.#bands;
  }

  /** Slots per band. */
  get rows(): number {
    return this.#rows;
  }

  /** Keys stored. */
  get size(): number {
    return this.#entries.size;
  }
}
