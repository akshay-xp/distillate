import { BitSet } from "../core/bitset.js";
import type { BytesLike } from "../core/bytes.js";
import {
  type Hash128,
  hash128KeyInto,
  probeLanesInto,
} from "../core/hasher.js";
import {
  assertPositiveInt,
  assertProbability,
  assertUint32,
  ParamError,
} from "../core/params.js";
import {
  bytesEqual,
  type FilterJSON,
  FORMAT_VERSION,
  fromJSONEnvelope,
  HASH_MURMUR128,
  readHeader,
  SerializationError,
  toJSONEnvelope,
  writeFrame,
} from "../core/serialize.js";
import { bloomSizing } from "../core/sizing.js";

const MAX_BITS = 0xffffffff;
const TYPE = 6;

/**
 * Body layout (little-endian): n (u32) | seed (u32) | epsilon (f64) | growth
 * (f64) | tightening (f64) | stageCount (u32) | 4 bytes padding, then one
 * 16-byte table entry per stage: m (u32) | k (u16) | 2 bytes padding |
 * capacity (u32) | count (u32). Each stage's bits follow, padded to a
 * multiple of 8 so every stage starts 8-byte aligned in the frame.
 */
const PARAMS_SIZE = 40;
const ENTRY_SIZE = 16;

const padded8 = (bytes: number): number => Math.ceil(bytes / 8) * 8;

// Stages fromBytes hands the constructor to adopt in place of a fresh stage 0,
// so a frame cannot make it allocate a first stage it does not store.
let restoring: Stage[] | undefined;

/**
 * Thrown by {@link ScalableBloomFilter.union} when the two filters were built
 * with different settings. Stage `i` has the same geometry in both only when
 * every setting matches, so no stage-by-stage merge exists otherwise.
 */
export class ScalableParamMismatchError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "ScalableParamMismatchError";
}

/** Settings for a {@link ScalableBloomFilter}. */
export interface ScalableBloomParams {
  /** Keys the first stage holds before the next one opens. */
  n: number;
  /** Target false-positive rate for the whole chain, e.g. `0.01` for 1%. */
  epsilon: number;
  /** Capacity multiplier from one stage to the next; defaults to `2`. */
  growth?: number;
  /**
   * Multiplier on each stage's false-positive target relative to the one
   * before; defaults to `0.85`. Lower spends more bits per stage to open
   * fewer of them.
   */
  tightening?: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/** The optional {@link ScalableBloomParams}, as `create` and `from` take them. */
export type ScalableBloomOptions = Omit<ScalableBloomParams, "n" | "epsilon">;

interface Stage {
  readonly bits: BitSet;
  readonly m: number;
  readonly k: number;
  readonly capacity: number;
  count: number;
}

/**
 * A Bloom filter that grows with its key count and keeps its false-positive
 * rate under `epsilon`, for when the number of keys is not known up front.
 *
 * It is a chain of Bloom stages. Stage `i` holds `n * growth ** i` keys at a
 * false-positive target of `epsilon * (1 - tightening) * tightening ** i`;
 * those targets sum to at most `epsilon`, however many stages open.
 *
 * @example
 * ```ts
 * const seen = ScalableBloomFilter.create(1000, 0.01);
 * seen.add("alice");
 * seen.has("alice"); // true
 * ```
 */
export class ScalableBloomFilter {
  readonly #n: number;
  readonly #epsilon: number;
  readonly #growth: number;
  readonly #tightening: number;
  readonly #seed: number;
  readonly #stages: Stage[] = [];
  readonly #hash: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };
  #probes = new Uint32Array(0);
  #newest: Stage;

  /**
   * Creates a filter whose first stage holds `n` keys, for a chain-wide
   * false-positive target.
   *
   * @param n - Keys the first stage holds.
   * @param epsilon - Target false-positive rate for the whole chain.
   * @param options - Optional growth, tightening and seed.
   * @returns A new, empty filter.
   */
  static create(
    n: number,
    epsilon: number,
    options: ScalableBloomOptions = {},
  ): ScalableBloomFilter {
    return new ScalableBloomFilter({ ...options, n, epsilon });
  }

  /**
   * Builds a filter from `keys`, with the first stage sized for their count;
   * it keeps growing as more keys arrive. Duplicates only oversize the first
   * stage, since a key already held is not counted again.
   *
   * @param keys - The keys to insert.
   * @param epsilon - Target false-positive rate for the whole chain.
   * @param options - Optional growth, tightening and seed.
   * @returns A new filter containing every key.
   */
  static from(
    keys: Iterable<BytesLike>,
    epsilon: number,
    options: ScalableBloomOptions = {},
  ): ScalableBloomFilter {
    const arr = [...keys];
    const f = ScalableBloomFilter.create(
      Math.max(1, arr.length),
      epsilon,
      options,
    );
    for (const key of arr) f.add(key);
    return f;
  }

  /**
   * @param params - The filter's settings.
   * @throws {@link ParamError} if a setting is out of range, or the first
   *   stage would need more than `2^32 - 1` bits.
   */
  constructor({
    n,
    epsilon,
    growth = 2,
    tightening = 0.85,
    seed = 0,
  }: ScalableBloomParams) {
    assertPositiveInt(n, "n");
    assertUint32(n, "n");
    assertProbability(epsilon, "epsilon");
    if (!Number.isFinite(growth) || growth <= 1) {
      throw new ParamError(
        `growth must be a finite number greater than 1, got ${String(growth)}`,
      );
    }
    assertProbability(tightening, "tightening");
    assertUint32(seed, "seed");
    this.#n = n;
    this.#epsilon = epsilon;
    this.#growth = growth;
    this.#tightening = tightening;
    this.#seed = seed;

    if (restoring) {
      this.#newest = this.#adopt(restoring);
      return;
    }
    const first = this.#geometry(0);
    if (first.m > MAX_BITS) {
      throw new ParamError(
        `the first stage needs ${String(first.m)} bits, more than ${String(MAX_BITS)}`,
      );
    }
    this.#newest = this.#open(first);
  }

  // Stage i's capacity and Bloom geometry. The false-positive targets form a
  // geometric series summing to at most epsilon, which is the chain's bound.
  #geometry(i: number): { capacity: number; m: number; k: number } {
    const capacity = Math.ceil(this.#n * this.#growth ** i);
    const target =
      this.#epsilon * (1 - this.#tightening) * this.#tightening ** i;
    return { capacity, ...bloomSizing(capacity, target) };
  }

  #open({ capacity, m, k }: { capacity: number; m: number; k: number }): Stage {
    const stage = { bits: new BitSet(m), m, k, capacity, count: 0 };
    this.#stages.push(stage);
    if (k > this.#probes.length) this.#probes = new Uint32Array(k);
    return stage;
  }

  // Each setting paired with other's, in the order a mismatch is reported.
  #settingPairs(other: ScalableBloomFilter): [string, number, number][] {
    return [
      ["n", this.#n, other.#n],
      ["epsilon", this.#epsilon, other.#epsilon],
      ["growth", this.#growth, other.#growth],
      ["tightening", this.#tightening, other.#tightening],
      ["seed", this.#seed, other.#seed],
    ];
  }

  #assertSameSettings(other: ScalableBloomFilter): void {
    for (const [name, a, b] of this.#settingPairs(other)) {
      if (a !== b) {
        throw new ScalableParamMismatchError(
          `cannot union scalable Bloom filters whose ${name} differs (${String(a)} vs ${String(b)})`,
        );
      }
    }
  }

  // Replaces the whole chain and returns its newest stage, the last.
  #adopt(stages: Stage[]): Stage {
    this.#stages.length = 0;
    this.#stages.push(...stages);
    const k = Math.max(...stages.map((s) => s.k));
    if (k > this.#probes.length) this.#probes = new Uint32Array(k);
    return stages.reduce((_, s) => s);
  }

  // Fills #probes for one stage from the key hashed into #hash, which every
  // stage shares.
  #probe(stage: Stage): void {
    probeLanesInto(
      this.#hash.w0,
      this.#hash.w1,
      stage.k,
      stage.m,
      this.#probes,
    );
  }

  #holds(stage: Stage): boolean {
    this.#probe(stage);
    for (let i = 0; i < stage.k; i++) {
      if (!stage.bits.get(this.#probes[i] ?? 0)) return false;
    }
    return true;
  }

  // Newest first: it holds the most keys, so a present key usually stops there.
  #anyHolds(): boolean {
    for (let i = this.#stages.length - 1; i >= 0; i--) {
      const stage = this.#stages[i];
      if (stage && this.#holds(stage)) return true;
    }
    return false;
  }

  /**
   * Adds a key. A key the filter already holds is not counted again, so
   * duplicates never use up a stage's capacity.
   *
   * @param key - The key to insert, as a string or bytes.
   * @throws RangeError if the next stage would need more than `2^32 - 1`
   *   bits; the filter is left unchanged and still answers queries.
   */
  add(key: BytesLike): void {
    hash128KeyInto(key, this.#seed, this.#hash);
    if (this.#anyHolds()) return;
    if (this.#newest.count >= this.#newest.capacity) {
      const i = this.#stages.length;
      const next = this.#geometry(i);
      if (next.m > MAX_BITS) {
        throw new RangeError(
          `stage ${String(i)} needs ${String(next.m)} bits, more than ${String(MAX_BITS)}; the filter cannot grow further`,
        );
      }
      this.#newest = this.#open(next);
    }
    const stage = this.#newest;
    this.#probe(stage);
    for (let i = 0; i < stage.k; i++) stage.bits.set(this.#probes[i] ?? 0);
    stage.count++;
  }

  /**
   * Tests whether a key is in the set.
   *
   * @param key - The key to test.
   * @returns `true` if present (possibly a false positive); `false` guarantees absence.
   */
  has(key: BytesLike): boolean {
    hash128KeyInto(key, this.#seed, this.#hash);
    return this.#anyHolds();
  }

  /**
   * Estimates the chain's current false-positive rate from each stage's actual
   * fill: a key is a false positive if any stage wrongly holds it, so this is
   * `1 - prod(1 - (setBits / m) ** k)`. It rises as keys are added and stays
   * under `epsilon` while every stage is within its capacity.
   *
   * @returns The estimated false-positive rate, in `[0, 1]`.
   */
  rate(): number {
    let miss = 1;
    for (const s of this.#stages) miss *= 1 - (s.bits.count() / s.m) ** s.k;
    return 1 - miss;
  }

  /**
   * Returns a new filter holding every key of this filter and `other`. Stage
   * `i` of the result is the OR of both inputs' stage `i`, and the result has
   * the longer of the two chains. Each stage's count becomes the smaller of
   * its capacity and the two counts summed: an upper bound, so the merged
   * chain opens its next stage early rather than late.
   *
   * @param other - A filter built with identical settings.
   * @returns A new filter; neither input is changed.
   * @throws {@link ScalableParamMismatchError} if any setting differs.
   */
  union(other: ScalableBloomFilter): ScalableBloomFilter {
    this.#assertSameSettings(other);
    const result = new ScalableBloomFilter({
      n: this.#n,
      epsilon: this.#epsilon,
      growth: this.#growth,
      tightening: this.#tightening,
      seed: this.#seed,
    });
    const [longer, shorter] =
      this.#stages.length >= other.#stages.length
        ? [this.#stages, other.#stages]
        : [other.#stages, this.#stages];
    const stages = longer.map((stage, i): Stage => {
      const bits = new BitSet(stage.m);
      bits.bytes.set(stage.bits.bytes);
      const twin = shorter[i];
      if (twin) {
        const out = bits.bytes;
        const bytes = twin.bits.bytes;
        for (let j = 0; j < out.length; j++) {
          out[j] = (out[j] ?? 0) | (bytes[j] ?? 0);
        }
      }
      return {
        bits,
        m: stage.m,
        k: stage.k,
        capacity: stage.capacity,
        count: Math.min(stage.capacity, stage.count + (twin?.count ?? 0)),
      };
    });
    result.#newest = result.#adopt(stages);
    return result;
  }

  /**
   * Tests structural equality: identical settings, the same stages with the
   * same counts, and identical bits, which is exactly when the two serialize
   * to the same bytes. Which stage a key lands in depends on when it arrived,
   * so two filters given the same keys in a different order can be unequal.
   *
   * @param other - The filter to compare against.
   * @returns `true` if the two filters are identical.
   */
  equals(other: ScalableBloomFilter): boolean {
    if (this.#settingPairs(other).some(([, a, b]) => a !== b)) return false;
    if (this.#stages.length !== other.#stages.length) return false;
    return this.#stages.every((s, i) => {
      const t = other.#stages[i];
      if (!t) return false;
      return (
        s.m === t.m &&
        s.k === t.k &&
        s.capacity === t.capacity &&
        s.count === t.count &&
        bytesEqual(s.bits.bytes, t.bits.bytes)
      );
    });
  }

  /**
   * Restores a filter from its {@link ScalableBloomFilter.toBytes} serialization.
   *
   * @param bytes - A frame produced by `toBytes`.
   * @returns The reconstructed filter.
   * @throws {@link SerializationError} (or a subclass) if the frame is malformed.
   */
  static fromBytes(bytes: Uint8Array): ScalableBloomFilter {
    const { type, body } = readHeader(bytes);
    if (type !== TYPE) {
      throw new SerializationError(
        `expected DSTL type ${String(TYPE)}, got ${String(type)}`,
      );
    }
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const stageCount = view.getUint32(32, true);
    const stages: Stage[] = [];
    let at = PARAMS_SIZE + ENTRY_SIZE * stageCount;
    for (let i = 0; i < stageCount; i++) {
      const entry = PARAMS_SIZE + ENTRY_SIZE * i;
      const m = view.getUint32(entry, true);
      const bits = new BitSet(m);
      bits.bytes.set(body.subarray(at, at + bits.bytes.length));
      stages.push({
        bits,
        m,
        k: view.getUint16(entry + 4, true),
        capacity: view.getUint32(entry + 8, true),
        count: view.getUint32(entry + 12, true),
      });
      at += padded8(bits.bytes.length);
    }
    restoring = stages;
    try {
      return new ScalableBloomFilter({
        n: view.getUint32(0, true),
        seed: view.getUint32(4, true),
        epsilon: view.getFloat64(8, true),
        growth: view.getFloat64(16, true),
        tightening: view.getFloat64(24, true),
      });
    } finally {
      restoring = undefined;
    }
  }

  /**
   * Serializes the filter to a portable little-endian frame, DSTL type 6.
   *
   * @returns The serialized filter, readable by {@link ScalableBloomFilter.fromBytes}.
   */
  toBytes(): Uint8Array {
    const payload = this.#stages.reduce(
      (sum, s) => sum + ENTRY_SIZE + padded8(s.bits.bytes.length),
      0,
    );
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: HASH_MURMUR128 },
      PARAMS_SIZE,
      payload,
      (body, view) => {
        view.setUint32(0, this.#n, true);
        view.setUint32(4, this.#seed, true);
        view.setFloat64(8, this.#epsilon, true);
        view.setFloat64(16, this.#growth, true);
        view.setFloat64(24, this.#tightening, true);
        view.setUint32(32, this.#stages.length, true);
        let at = PARAMS_SIZE + ENTRY_SIZE * this.#stages.length;
        this.#stages.forEach((s, i) => {
          const entry = PARAMS_SIZE + ENTRY_SIZE * i;
          view.setUint32(entry, s.m, true);
          view.setUint16(entry + 4, s.k, true);
          view.setUint32(entry + 8, s.capacity, true);
          view.setUint32(entry + 12, s.count, true);
          body.set(s.bits.bytes, at);
          at += padded8(s.bits.bytes.length);
        });
      },
    );
  }

  /**
   * Serializes the filter to a JSON-friendly envelope wrapping the base64 of
   * {@link ScalableBloomFilter.toBytes}.
   *
   * @returns The JSON envelope.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }

  /**
   * Restores a filter from its {@link ScalableBloomFilter.toJSON} envelope.
   *
   * @param value - The JSON envelope.
   * @returns The reconstructed filter.
   */
  static fromJSON(value: unknown): ScalableBloomFilter {
    return ScalableBloomFilter.fromBytes(fromJSONEnvelope(value));
  }

  /** Keys added that the filter did not already hold. */
  get count(): number {
    return this.#stages.reduce((sum, s) => sum + s.count, 0);
  }

  /** Keys the open stages hold between them before the next one opens. */
  get capacity(): number {
    return this.#stages.reduce((sum, s) => sum + s.capacity, 0);
  }

  /** Number of open stages. */
  get stages(): number {
    return this.#stages.length;
  }

  /** Total bits across every stage. */
  get m(): number {
    return this.#stages.reduce((sum, s) => sum + s.m, 0);
  }

  /** Analytic design bits-per-key, `m / capacity`. */
  get bitsPerKey(): number {
    return this.m / this.capacity;
  }

  /** Hash seed shared by every stage. */
  get seed(): number {
    return this.#seed;
  }

  /** Target false-positive rate for the whole chain. */
  get epsilon(): number {
    return this.#epsilon;
  }

  /** Capacity multiplier from one stage to the next. */
  get growth(): number {
    return this.#growth;
  }

  /** False-positive target multiplier from one stage to the next. */
  get tightening(): number {
    return this.#tightening;
  }
}
