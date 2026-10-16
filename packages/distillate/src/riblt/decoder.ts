import type { BytesLike } from "../core/bytes.js";
import {
  hash128Key,
  hash128KeyInto,
  type Hash128,
  R64,
} from "../core/hasher.js";
import { forEachItem } from "../core/iterable.js";
import { assertUint32, ParamError } from "../core/params.js";
import type { RibltParams } from "./encoder.js";
import { readSymbolAt, readSymbols } from "./frame.js";
import { checksum, nextIndex } from "./mapping.js";
import { CodingWindow } from "./window.js";

/** Lanes per coded symbol: sum lo, sum hi, checksum lo, checksum hi, count. */
const LANES = 5;

/**
 * Ingests one coded symbol (the layout `nextSymbol` writes) and returns whether
 * the decoder has decoded. Exported from this module but not from the subpath,
 * so it is no part of the public API. Assigned in RibltDecoder's static block.
 */
export let pushSymbol!: <K extends BytesLike>(
  decoder: RibltDecoder<K>,
  symbol: Uint32Array,
) => boolean;

/**
 * Thrown when a frame was encoded under a different seed than the decoder's.
 * The two sides hash keys differently, so no prefix of that stream can ever
 * decode; both peers must agree on the seed.
 */
export class RibltParamMismatchError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "RibltParamMismatchError";
}

/**
 * The receiving side of rateless set reconciliation: fed a peer's coded
 * symbols in order, it peels them until it holds exactly the keys that differ
 * between the two sets.
 *
 * @example
 * ```ts
 * const decoder = RibltDecoder.from(["alice", "carol"]);
 * ```
 */
export class RibltDecoder<K extends BytesLike = BytesLike> {
  static {
    pushSymbol = (decoder, symbol) => decoder.#push(symbol);
  }

  readonly #seed: number;
  // The caller's keys, kept so local() can hand back the keys themselves.
  readonly #keys: K[] = [];
  // Local keys' symbols, subtracted from each arriving coded symbol.
  readonly #local = new CodingWindow();
  // Symbols peeled as present only on the remote side, and only on this one.
  readonly #remote = new CodingWindow();
  readonly #localOnly = new CodingWindow();
  // Received coded symbols, minus every symbol peeled so far.
  #cells = new Uint32Array(LANES * 64);
  #received = 0;
  // Indices of cells that may be pure; rechecked when taken.
  #queue = new Int32Array(64);
  // Reused per symbol so a peeled symbol's index sequence allocates nothing.
  readonly #state = new Uint32Array(2);
  // Reused across add() so hashing a key allocates nothing per call.
  readonly #hash: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };
  readonly #symbol = new Uint32Array(2);
  // One coded symbol read out of a frame.
  readonly #register = new Uint32Array(5);

  /**
   * @throws {@link ParamError} If `seed` is not a uint32.
   */
  constructor(params: RibltParams = {}) {
    const { seed = 0 } = params;
    assertUint32(seed, "seed");
    this.#seed = seed;
  }

  /**
   * Builds a decoder over this side's `keys`, which must be distinct:
   * {@link RibltDecoder.push} refuses the first frame otherwise.
   *
   * @throws {@link ParamError} If `seed` is not a uint32.
   */
  static from<K extends BytesLike>(
    keys: Iterable<K>,
    params?: RibltParams,
  ): RibltDecoder<K> {
    const decoder = new RibltDecoder<K>(params);
    forEachItem(keys, (key) => {
      decoder.add(key);
    });
    return decoder;
  }

  /**
   * The 64-bit hash that {@link RibltDecoder.remote} reports for `key`, so the
   * peer holding the key can map a reported hash back to it.
   *
   * @throws {@link ParamError} If `seed` is not a uint32.
   */
  static hashOf(key: BytesLike, seed = 0): bigint {
    assertUint32(seed, "seed");
    const { w0, w1 } = hash128Key(key, seed);
    return (BigInt(w1) << 32n) | BigInt(w0);
  }

  /** Whether every received symbol has been peeled: the difference is known. */
  get decoded(): boolean {
    if (this.#received === 0) return false;
    const cells = this.#cells;
    return (
      (cells[0] ?? 0) === 0 &&
      (cells[1] ?? 0) === 0 &&
      (cells[2] ?? 0) === 0 &&
      (cells[3] ?? 0) === 0 &&
      (cells[4] ?? 0) === 0
    );
  }

  /**
   * Adds a key this side holds. Keys must be distinct, and all added before
   * the first coded symbol arrives.
   *
   * @throws {@link ParamError} If a coded symbol was already received.
   */
  add(key: K): void {
    if (this.#received > 0) {
      throw new ParamError(
        "cannot add a local key after coded symbols arrived; they were already reduced against the earlier keys",
      );
    }
    hash128KeyInto(key, this.#seed, this.#hash);
    this.#keys.push(key);
    this.#symbol[0] = this.#hash.w0;
    this.#symbol[1] = this.#hash.w1;
    this.#local.add(this.#symbol, 0, 0);
  }

  /** Hashes of the keys only the remote side holds, as {@link RibltDecoder.hashOf} gives them. */
  remote(): bigint[] {
    const out: bigint[] = [];
    this.#remote.forEach((lo, hi) => {
      out.push((BigInt(hi) << 32n) | BigInt(lo));
    });
    return out;
  }

  /**
   * The keys only this side holds, as they were added. Re-hashes each local
   * key once rather than keeping a hash-to-key map over the whole set.
   */
  local(): K[] {
    const wanted = new Map<number, number[]>();
    this.#localOnly.forEach((lo, hi) => {
      const his = wanted.get(lo);
      if (his === undefined) wanted.set(lo, [hi]);
      else his.push(hi);
    });
    const out: K[] = [];
    if (wanted.size === 0) return out;
    const hash = this.#hash;
    for (const key of this.#keys) {
      hash128KeyInto(key, this.#seed, hash);
      if (wanted.get(hash.w0)?.includes(hash.w1)) out.push(key);
    }
    return out;
  }

  /**
   * Ingests a frame from the peer's {@link RibltEncoder.take} and reports
   * whether the difference is now decoded. Frames must arrive in order.
   * A rejected frame leaves the decoder as it was.
   *
   * @throws {@link RibltParamMismatchError} If the frame's seed differs.
   * @throws {@link ParamError} If the frame does not start at the next
   * symbol this decoder expects. On the first frame, if two local keys hash
   * alike under the seed: a repeated key, or a 64-bit collision that another
   * seed resolves.
   */
  push(frame: Uint8Array): boolean {
    const { seed, start, count, view } = readSymbols(frame);
    if (seed !== this.#seed) {
      throw new RibltParamMismatchError(
        `frame seed ${String(seed)} differs from the decoder's ${String(this.#seed)}`,
      );
    }
    if (start !== this.#received) {
      throw new ParamError(
        `frame starts at symbol ${String(start)}, but the decoder expects ${String(this.#received)}; frames must arrive in order`,
      );
    }
    if (this.#received === 0) this.#local.assertDistinct(this.#seed);
    for (let i = 0; i < count; i++) {
      readSymbolAt(view, count, i, this.#register);
      this.#push(this.#register);
    }
    return this.decoded;
  }

  #push(symbol: Uint32Array): boolean {
    const at = this.#received;
    if (LANES * (at + 1) > this.#cells.length) {
      const cells = new Uint32Array(this.#cells.length * 2);
      cells.set(this.#cells);
      this.#cells = cells;
    }
    this.#cells.set(symbol, LANES * at);
    this.#local.applyTo(this.#cells, LANES * at, at, -1);
    this.#remote.applyTo(this.#cells, LANES * at, at, -1);
    this.#localOnly.applyTo(this.#cells, LANES * at, at, 1);
    this.#received++;
    this.#peel(at);
    return this.decoded;
  }

  #pure(at: number): boolean {
    const cells = this.#cells;
    const base = LANES * at;
    const count = (cells[base + 4] ?? 0) | 0;
    if (count !== 1 && count !== -1) return false;
    R64[0] = cells[base] ?? 0;
    R64[1] = cells[base + 1] ?? 0;
    checksum();
    return (
      R64[0] === (cells[base + 2] ?? 0) && R64[1] === (cells[base + 3] ?? 0)
    );
  }

  #peel(from: number): void {
    let queue = this.#queue;
    let length = 0;
    if (this.#pure(from)) queue[length++] = from;
    while (length > 0) {
      const at = queue[--length] ?? 0;
      if (!this.#pure(at)) continue;
      const cells = this.#cells;
      const base = LANES * at;
      const lo = cells[base] ?? 0;
      const hi = cells[base + 1] ?? 0;
      const checkLo = cells[base + 2] ?? 0;
      const checkHi = cells[base + 3] ?? 0;
      // +1: only the remote side holds it; -1: only this side.
      const sign = (cells[base + 4] ?? 0) | 0;
      const state = this.#state;
      state[0] = checkLo;
      state[1] = checkHi;
      for (let i = 0; i < this.#received; i = nextIndex(state, 0, i)) {
        const b = LANES * i;
        cells[b] = (cells[b] ?? 0) ^ lo;
        cells[b + 1] = (cells[b + 1] ?? 0) ^ hi;
        cells[b + 2] = (cells[b + 2] ?? 0) ^ checkLo;
        cells[b + 3] = (cells[b + 3] ?? 0) ^ checkHi;
        cells[b + 4] = (cells[b + 4] ?? 0) - sign;
        if (this.#pure(i)) {
          if (length === queue.length) {
            const grown = new Int32Array(queue.length * 2);
            grown.set(queue);
            queue = grown;
            this.#queue = grown;
          }
          queue[length++] = i;
        }
      }
      // From the scratch, not the cell: peeling just cleared the cell.
      this.#symbol[0] = lo;
      this.#symbol[1] = hi;
      (sign === 1 ? this.#remote : this.#localOnly).add(
        this.#symbol,
        0,
        this.#received,
      );
    }
  }
}
