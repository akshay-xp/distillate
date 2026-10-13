import type { BytesLike } from "../core/bytes.js";
import {
  fmix32,
  hash128KeyInto,
  reduce,
  type Hash128,
} from "../core/hasher.js";
import { assertUint32, ParamError } from "../core/params.js";
import { MINHASH_MAX_K, MINHASH_MIN_K } from "./sizing.js";

// Marks a slot no key has reached. A hash value equal to it is clamped one
// below, so the sentinel never stands for a real minimum.
const EMPTY = 0xffffffff;

function assertK(k: number): void {
  if (!Number.isInteger(k) || k < MINHASH_MIN_K || k > MINHASH_MAX_K) {
    throw new ParamError(
      `k must be an integer in [${String(MINHASH_MIN_K)}, ${String(MINHASH_MAX_K)}], got ${String(k)}`,
    );
  }
}

/** Construction parameters for a {@link MinHash} sketch. */
export interface MinHashParams {
  /** Slots in the signature; defaults to `128`. */
  k?: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A MinHash sketch: estimates the Jaccard similarity of two key sets from
 * fixed-size signatures, in space fixed by `k` rather than by the sets.
 *
 * @example
 * ```ts
 * const a = new MinHash();
 * a.add("alice");
 * ```
 */
export class MinHash {
  readonly #slots: Uint32Array;
  readonly #seed: number;
  // Densified slots for jaccard, rebuilt on each call rather than allocated.
  readonly #dense: Uint32Array;
  // Reused across add() so hashing a key allocates nothing per call.
  readonly #scratch: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };
  // Slots holding a real minimum; zero means the sketch has seen no key.
  #filled = 0;

  /**
   * Creates a sketch with an explicit slot count.
   *
   * @param params - Slot count and optional hash seed.
   */
  constructor({ k = 128, seed = 0 }: MinHashParams = {}) {
    assertK(k);
    assertUint32(seed, "seed");
    this.#slots = new Uint32Array(k).fill(EMPTY);
    this.#seed = seed;
    this.#dense = new Uint32Array(k);
  }

  /** Slots in the signature. */
  get k(): number {
    return this.#slots.length;
  }

  /** The hash seed. */
  get seed(): number {
    return this.#seed;
  }

  /**
   * Standard error of {@link jaccard} at its worst, J = 0.5:
   * `0.5 / sqrt(k)`. Analytic, for reporting.
   */
  get standardError(): number {
    return 0.5 / Math.sqrt(this.#slots.length);
  }

  /** Whether the sketch has seen no key. */
  get isEmpty(): boolean {
    return this.#filled === 0;
  }

  /**
   * Records a key. One hash picks one slot, which keeps the smaller value:
   * one-permutation hashing, O(1) per key where classic MinHash is O(k).
   *
   * @param key - The key to record.
   */
  add(key: BytesLike): void {
    const scratch = this.#scratch;
    hash128KeyInto(key, this.#seed, scratch);
    const slots = this.#slots;
    const i = reduce(scratch.w0, slots.length);
    const value = scratch.w1 === EMPTY ? EMPTY - 1 : scratch.w1;
    const held = slots[i] ?? EMPTY;
    if (value >= held) return;
    if (held === EMPTY) this.#filled++;
    slots[i] = value;
  }

  /**
   * Merges two sketches: the result is the sketch of the union of their key
   * sets. Neither input changes.
   *
   * @param other - The sketch to merge with.
   * @returns A new sketch holding both key sets.
   * @throws {@link ParamError} if `k` or the seed differ, since the two would
   * have sent the same key to different slots or values.
   */
  union(other: MinHash): MinHash {
    this.#assertCompatible(other);
    const merged = new MinHash({ k: this.#slots.length, seed: this.#seed });
    const out = merged.#slots;
    const theirs = other.#slots;
    let filled = 0;
    for (let i = 0; i < out.length; i++) {
      const value = Math.min(this.#slots[i] ?? EMPTY, theirs[i] ?? EMPTY);
      out[i] = value;
      if (value !== EMPTY) filled++;
    }
    merged.#filled = filled;
    return merged;
  }

  /**
   * Whether two sketches hold the same slots at the same `k` and seed.
   *
   * @param other - The sketch to compare against.
   * @returns `true` if the two would answer every query identically.
   */
  equals(other: MinHash): boolean {
    if (other.#seed !== this.#seed) return false;
    const mine = this.#slots;
    const theirs = other.#slots;
    if (mine.length !== theirs.length) return false;
    for (let i = 0; i < mine.length; i++) {
      if (mine[i] !== theirs[i]) return false;
    }
    return true;
  }

  #assertCompatible(other: MinHash): void {
    if (other.#slots.length !== this.#slots.length) {
      throw new ParamError(
        `cannot combine sketches with different k, got ${String(this.#slots.length)} and ${String(other.#slots.length)}`,
      );
    }
    if (other.#seed !== this.#seed) {
      throw new ParamError(
        `cannot combine sketches with different seeds, got ${String(this.#seed)} and ${String(other.#seed)}`,
      );
    }
  }

  /**
   * Estimates the Jaccard similarity `|A ∩ B| / |A ∪ B|` of the two key sets,
   * within {@link standardError}.
   *
   * @param other - The sketch to compare against.
   * @returns A similarity in `[0, 1]`; `1` for two empty sketches, `0` when
   * exactly one is empty.
   */
  jaccard(other: MinHash): number {
    this.#assertCompatible(other);
    if (this.isEmpty || other.isEmpty) {
      return this.isEmpty && other.isEmpty ? 1 : 0;
    }
    const mine = this.#densify(this.#dense);
    const theirs = other.#densify(other.#dense);
    let equal = 0;
    for (let i = 0; i < mine.length; i++) {
      if (mine[i] === theirs[i]) equal++;
    }
    return equal / mine.length;
  }

  /**
   * The densified signature: every slot filled, ready to compare slot by slot
   * or to band for locality-sensitive hashing. Independent of insertion order.
   *
   * @returns A fresh array of `k` values; all `0xffffffff` for an empty sketch.
   */
  signature(): Uint32Array {
    const out = new Uint32Array(this.#slots.length);
    if (this.isEmpty) {
      out.set(this.#slots);
      return out;
    }
    return this.#densify(out);
  }

  // Optimal densification (Shrivastava 2017): an empty slot borrows the value
  // of the first filled slot its own probe sequence reaches. The sequence
  // depends only on the slot, attempt and seed, never on the contents, so two
  // sketches with the same k and seed borrow from the same places and an
  // empty slot matches exactly when the slots it borrows from do.
  #densify(out: Uint32Array): Uint32Array {
    const slots = this.#slots;
    const k = slots.length;
    for (let i = 0; i < k; i++) {
      let value = slots[i] ?? EMPTY;
      for (let attempt = 1; value === EMPTY; attempt++) {
        const probe = fmix32(
          (Math.imul(i, 0x9e3779b1) ^
            Math.imul(attempt, 0x85ebca6b) ^
            this.#seed) >>>
            0,
        );
        value = slots[reduce(probe, k)] ?? EMPTY;
      }
      out[i] = value;
    }
    return out;
  }
}
