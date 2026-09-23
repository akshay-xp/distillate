import type { BytesLike } from "../core/bytes.js";
import { hash32x2Into, probeAt } from "../core/hasher.js";
import { assertPositiveInt, assertUint32, ParamError } from "../core/params.js";
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
import { countMinSizing } from "../core/sizing.js";

const TYPE = 8;

/**
 * Params occupy 12 bytes and the block is padded to 16, so the counters start
 * at frame offset 32 and a foreign reader can map them as `u32`.
 */
const PARAMS_SIZE = 16;
const PARAMS_FIELDS_END = 12;

/**
 * The total a frame's counters imply, which is why no total is stored.
 *
 * Under plain increment every add touches one counter per row, so every row
 * sums to the same value. Deriving the total therefore doubles as an integrity
 * check: rows that disagree were not written by this format, and a sum past
 * the safe-integer range could not have been reached by counting.
 */
function rowSum(counters: Uint32Array, width: number, depth: number): number {
  let expected = 0;
  for (let r = 0; r < depth; r++) {
    let sum = 0;
    const from = r * width;
    for (let c = from; c < from + width; c++) sum += counters[c] ?? 0;
    if (sum > Number.MAX_SAFE_INTEGER) {
      throw new SerializationError(
        `countmin: row ${String(r)} sums to ${String(sum)}, past the safe integer range`,
      );
    }
    if (r === 0) expected = sum;
    else if (sum !== expected) {
      throw new SerializationError(
        `countmin: row ${String(r)} sums to ${String(sum)}, but row 0 sums to ${String(expected)}`,
      );
    }
  }
  return expected;
}

/** Thrown when an add would carry a counter past what a u32 holds. */
export class CountMinOverflowError extends RangeError {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "CountMinOverflowError";
}

/** Options accepted alongside a sizing solve: everything but the geometry. */
export type CountMinOptions = Omit<CountMinParams, "width" | "depth">;

/** Low-level Count-Min sketch parameters. */
export interface CountMinParams {
  /** Counters per row. */
  width: number;
  /** Number of rows, one probe each. */
  depth: number;
  /** Hash seed; defaults to `0`. */
  seed?: number;
}

/**
 * A Count-Min sketch: a fixed-size frequency estimate with a tunable
 * overestimate and no underestimate.
 *
 * @example
 * ```ts
 * const sketch = CountMinSketch.create(0.001, 0.001);
 * sketch.add("alice");
 * sketch.add("alice", 3);
 * sketch.count("alice"); // 4 (or a rare overestimate)
 * ```
 */
export class CountMinSketch {
  readonly #counters: Uint32Array;
  readonly #width: number;
  readonly #depth: number;
  readonly #seed: number;
  // Reused across add and count so hashing a key allocates nothing per call.
  readonly #words = new Uint32Array(2);
  // One position per row, held between add's overflow check and its writes.
  readonly #positions: Uint32Array;
  #total = 0;

  /**
   * Creates a sketch whose estimate is at most `epsilon * total` above the
   * true count, with probability `1 - delta`.
   *
   * Unlike a filter, a sketch is sized by the error it targets rather than by
   * how many keys it will see, so no key count is needed.
   *
   * @param epsilon - Error factor relative to the total recorded, e.g. `0.001`.
   * @param delta - Probability the bound is exceeded, e.g. `0.001`.
   * @param options - Optional seed.
   * @returns A new, empty sketch.
   */
  static create(
    epsilon: number,
    delta: number,
    options: CountMinOptions = {},
  ): CountMinSketch {
    return new CountMinSketch({
      ...options,
      ...countMinSizing(epsilon, delta),
    });
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
   * @param delta - Probability the bound is exceeded.
   * @param options - Optional seed.
   * @returns A new sketch holding every occurrence.
   */
  static from(
    keys: Iterable<BytesLike>,
    epsilon: number,
    delta: number,
    options: CountMinOptions = {},
  ): CountMinSketch {
    const sketch = CountMinSketch.create(epsilon, delta, options);
    for (const key of keys) sketch.add(key);
    return sketch;
  }

  /**
   * Restores a sketch from its {@link CountMinSketch.toBytes} serialization.
   *
   * Built from the geometry the frame stores, never from a sizing solve: the
   * constructor takes `width` and `depth` directly, so there is nothing to
   * re-derive and nothing to disagree about.
   *
   * @param bytes - The serialized sketch.
   * @returns The reconstructed sketch.
   */
  static fromBytes(bytes: Uint8Array): CountMinSketch {
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
    assertMinBodyLength(body.length, PARAMS_SIZE, "countmin");
    assertParamsPadding(body, PARAMS_FIELDS_END, PARAMS_SIZE, "countmin");
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const width = view.getUint32(0, true);
    const depth = view.getUint32(4, true);
    const seed = view.getUint32(8, true);
    // Length is checked before the constructor allocates, so a forged geometry
    // cannot request memory the body does not hold.
    assertBodyLength(body.length, PARAMS_SIZE + 4 * width * depth, "countmin");
    let sketch: CountMinSketch;
    try {
      sketch = new CountMinSketch({ width, depth, seed });
    } catch (err) {
      // A geometry the body agrees with can still be one the constructor
      // refuses, and a caller decoding a frame should see one error family.
      if (err instanceof ParamError) {
        throw new SerializationError(`countmin: ${err.message}`);
      }
      throw err;
    }
    const counters = sketch.#counters;
    for (let i = 0; i < counters.length; i++) {
      counters[i] = view.getUint32(PARAMS_SIZE + 4 * i, true);
    }
    sketch.#total = rowSum(counters, width, depth);
    return sketch;
  }

  /**
   * Constructs a sketch from low-level {@link CountMinParams}. Prefer
   * {@link CountMinSketch.create} unless restoring a specific geometry.
   */
  constructor({ width, depth, seed = 0 }: CountMinParams) {
    assertPositiveInt(width, "width");
    assertUint32(width, "width");
    assertPositiveInt(depth, "depth");
    assertUint32(depth, "depth");
    assertUint32(seed, "seed");
    // Counters live in one flat array addressed by a 32-bit offset, the same
    // limit BloomFilter puts on m.
    if (width * depth > 0xffffffff) {
      throw new ParamError(
        `width ${String(width)} by depth ${String(depth)} needs ${String(width * depth)} counters, above the maximum ${String(0xffffffff)}`,
      );
    }
    this.#counters = new Uint32Array(width * depth);
    this.#positions = new Uint32Array(depth);
    this.#width = width;
    this.#depth = depth;
    this.#seed = seed;
  }

  /** Counters per row. */
  get width(): number {
    return this.#width;
  }

  /** Number of rows, one probe each. */
  get depth(): number {
    return this.#depth;
  }

  /** Hash seed. */
  get seed(): number {
    return this.#seed;
  }

  /** Sum of every count recorded, the denominator of the error bound. */
  get total(): number {
    return this.#total;
  }

  /**
   * Error factor the geometry implements, `e / width`.
   *
   * Sizing rounds `width` up, so this is at or below the `epsilon` passed to
   * {@link CountMinSketch.create}: the sketch reports what it delivers rather
   * than what was asked for.
   */
  get epsilon(): number {
    return Math.E / this.#width;
  }

  /**
   * Probability the error bound is exceeded, `e ** -depth`. At or below the
   * `delta` passed to {@link CountMinSketch.create}, for the same reason.
   */
  get delta(): number {
    return Math.exp(-this.#depth);
  }

  /**
   * The additive error bound right now, `epsilon * total`. A count is at most
   * this far above the truth, with probability `1 - delta`.
   *
   * It grows with what the sketch has recorded, so an estimate means less as
   * the stream goes on, the way a filter's `rate()` rises as it fills.
   *
   * @returns The bound, `0` for an empty sketch.
   */
  error(): number {
    return this.epsilon * this.#total;
  }

  // Row r's probe for the key hashed into #words, as an offset into #counters.
  #positionAt(row: number): number {
    return (
      row * this.#width +
      probeAt(this.#words[0] ?? 0, this.#words[1] ?? 0, row, this.#width)
    );
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
    hash32x2Into(key, this.#seed, this.#words);
    // Every position is checked before any is written, so a refused add leaves
    // the sketch exactly as it was rather than partly updated.
    const headroom = 0xffffffff - count;
    for (let r = 0; r < this.#depth; r++) {
      const at = this.#positionAt(r);
      if ((this.#counters[at] ?? 0) > headroom) {
        throw new CountMinOverflowError(
          `adding ${String(count)} would carry a counter past ${String(0xffffffff)}`,
        );
      }
      this.#positions[r] = at;
    }
    for (let r = 0; r < this.#depth; r++) {
      const at = this.#positions[r] ?? 0;
      this.#counters[at] = (this.#counters[at] ?? 0) + count;
    }
    this.#total += count;
  }

  /**
   * Serializes the sketch to a portable little-endian byte layout.
   *
   * The total is not stored. Under plain increment every row sums to it, so
   * the field would be redundant, and a reader deriving it instead gets an
   * integrity check on the counters for free.
   *
   * @returns The serialized sketch, readable by {@link CountMinSketch.fromBytes}.
   */
  toBytes(): Uint8Array {
    const counters = this.#counters;
    return writeFrame(
      { version: FORMAT_VERSION, type: TYPE, flags: HASH_MURMUR128 },
      PARAMS_SIZE,
      4 * counters.length,
      (_, view) => {
        view.setUint32(0, this.#width, true);
        view.setUint32(4, this.#depth, true);
        view.setUint32(8, this.#seed, true);
        counters.forEach((c, i) => {
          view.setUint32(PARAMS_SIZE + 4 * i, c, true);
        });
      },
    );
  }

  /**
   * Serializes the sketch to a JSON-friendly envelope wrapping the base64 of
   * {@link CountMinSketch.toBytes}.
   *
   * @returns The envelope, readable by {@link CountMinSketch.fromJSON}.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }

  /**
   * Restores a sketch from its {@link CountMinSketch.toJSON} envelope.
   *
   * @param value - The JSON envelope.
   * @returns The reconstructed sketch.
   */
  static fromJSON(value: unknown): CountMinSketch {
    return CountMinSketch.fromBytes(fromJSONEnvelope(value));
  }

  /**
   * Estimates how many times a key was added. The estimate is never below the
   * true count and is at most {@link CountMinSketch.error} above it.
   *
   * @param key - The key to estimate.
   * @returns The estimated count, `0` for a key the sketch has not seen.
   */
  count(key: BytesLike): number {
    hash32x2Into(key, this.#seed, this.#words);
    let min = Infinity;
    for (let r = 0; r < this.#depth; r++) {
      const at = this.#counters[this.#positionAt(r)] ?? 0;
      if (at < min) min = at;
    }
    return min;
  }
}
