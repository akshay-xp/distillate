// Six bits hold a rho of up to 63, and the largest rho a sketch can produce is
// 65 - p, so 61 at the minimum precision. Registers therefore never straddle
// more than two bytes, which is what lets get/set work on a single byte pair.
const WIDTH = 6;
const MASK = 0x3f;

/**
 * HyperLogLog register array: `2 ** p` values of six bits each, packed into a
 * `Uint8Array`. Packing costs `3 * 2 ** p / 4` bytes, so 12 KiB at `p = 14`,
 * against 16 KiB for a byte per register.
 */
export class Registers {
  readonly #bytes: Uint8Array;

  constructor(p: number) {
    // 6 * 2**p is divisible by 8 for every p >= 2, so no rounding is needed.
    this.#bytes = new Uint8Array((WIDTH * 2 ** p) / 8);
  }

  /** Live view of the packed bytes, for serialization. */
  get bytes(): Uint8Array {
    return this.#bytes;
  }

  /** Reads the register at `i`. */
  get(i: number): number {
    const bit = i * WIDTH;
    const at = bit >>> 3;
    const lo = this.#bytes[at] ?? 0;
    const hi = this.#bytes[at + 1] ?? 0;
    return ((lo | (hi << 8)) >>> (bit & 7)) & MASK;
  }

  /**
   * Writes `v` into the register at `i` if it is larger than what is there.
   * Registers only ever climb, which is what makes adding a key idempotent and
   * merging sketches a matter of taking maxima.
   */
  raise(i: number, v: number): void {
    if (v > this.get(i)) this.set(i, v);
  }

  /** Writes `v`, a value of at most six bits, into the register at `i`. */
  set(i: number, v: number): void {
    const bit = i * WIDTH;
    const at = bit >>> 3;
    const off = bit & 7;
    const lo = this.#bytes[at] ?? 0;
    const hi = this.#bytes[at + 1] ?? 0;
    const word = ((lo | (hi << 8)) & ~(MASK << off)) | ((v & MASK) << off);
    this.#bytes[at] = word & 0xff;
    // A register whose span reaches past `at` always has `at + 1` in range;
    // the final register fits inside its own byte. See the WIDTH note above.
    if (at + 1 < this.#bytes.length) this.#bytes[at + 1] = (word >>> 8) & 0xff;
  }
}
