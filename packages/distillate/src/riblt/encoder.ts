import type { BytesLike } from "../core/bytes.js";
import { hash128KeyInto, type Hash128 } from "../core/hasher.js";
import { forEachItem } from "../core/iterable.js";
import { assertPositiveInt, assertUint32, ParamError } from "../core/params.js";
import { writeSymbols } from "./frame.js";
import { CodingWindow } from "./window.js";

/** Construction parameters shared by {@link RibltEncoder} and its decoder. */
export interface RibltParams {
  /** Hash seed; both peers must use the same one. Defaults to `0`. */
  seed?: number;
}

/**
 * Writes the encoder's next coded symbol into `out` (sum lo, sum hi, checksum
 * lo, checksum hi, count as u32). Exported from this module but not from the
 * subpath, so it is no part of the public API. Assigned in RibltEncoder's
 * static block, the one place outside an instance method that can reach its
 * private members.
 */
export let nextSymbol!: (encoder: RibltEncoder, out: Uint32Array) => void;

/**
 * The sending side of rateless set reconciliation: turns a key set into an
 * endless stream of coded symbols, a prefix of which lets a peer holding a
 * similar set decode exactly the keys that differ.
 *
 * @example
 * ```ts
 * const encoder = RibltEncoder.from(["alice", "bob"]);
 * ```
 */
export class RibltEncoder {
  static {
    nextSymbol = (encoder, out) => {
      encoder.#next(out);
    };
  }

  readonly #seed: number;
  readonly #window = new CodingWindow();
  #index = 0;
  // Reused across add() so hashing a key allocates nothing per call.
  readonly #hash: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };
  readonly #symbol = new Uint32Array(2);

  /**
   * @throws {@link ParamError} If `seed` is not a uint32.
   */
  constructor(params: RibltParams = {}) {
    const { seed = 0 } = params;
    assertUint32(seed, "seed");
    this.#seed = seed;
  }

  /**
   * Builds an encoder over `keys`, which must hold no duplicates: a repeated
   * key cancels itself out of every coded symbol.
   *
   * @throws {@link ParamError} If `seed` is not a uint32.
   */
  static from(keys: Iterable<BytesLike>, params?: RibltParams): RibltEncoder {
    const encoder = new RibltEncoder(params);
    forEachItem(keys, (key) => {
      encoder.add(key);
    });
    return encoder;
  }

  /**
   * Adds a key. Keys must be distinct, and all added before the first coded
   * symbol is produced.
   *
   * @throws {@link ParamError} If a coded symbol was already produced.
   */
  add(key: BytesLike): void {
    if (this.#index > 0) {
      throw new ParamError(
        "cannot add a key after coded symbols were produced; the peer would decode a set that never existed",
      );
    }
    hash128KeyInto(key, this.#seed, this.#hash);
    this.#symbol[0] = this.#hash.w0;
    this.#symbol[1] = this.#hash.w1;
    this.#window.add(this.#symbol, 0, 0);
  }

  /**
   * Produces the next `n` coded symbols as one frame, for the peer's
   * {@link RibltDecoder.push}. Frames must reach the decoder in order.
   *
   * @throws {@link ParamError} If `n` is not a positive integer.
   */
  take(n: number): Uint8Array {
    assertPositiveInt(n, "n");
    if (this.#index === 0) this.#window.assertDistinct(this.#seed);
    return writeSymbols(this.#seed, this.#index, n, (out) => {
      this.#next(out);
    });
  }

  /**
   * Yields consecutive {@link RibltEncoder.take} frames of `n` symbols
   * forever; the caller stops once the peer reports it has decoded.
   *
   * @throws {@link ParamError} If `n` is not a positive integer, on the first
   * `next()`.
   */
  *stream(n: number): Generator<Uint8Array, never, undefined> {
    for (;;) yield this.take(n);
  }

  #next(out: Uint32Array): void {
    out.fill(0);
    this.#window.applyTo(out, 0, this.#index++, 1);
  }
}
