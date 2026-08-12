export class BitSetRangeError extends RangeError {
  override readonly name = "BitSetRangeError";
}

const MAX_BITS = 2 ** 32;

export class BitSet {
  readonly #bits: Uint8Array;

  constructor(nbits: number) {
    if (nbits > MAX_BITS) {
      throw new BitSetRangeError(
        `BitSet capacity ${String(nbits)} exceeds the 2^32-bit limit`,
      );
    }
    this.#bits = new Uint8Array(Math.ceil(nbits / 8));
  }

  set(i: number): void {
    const idx = i >>> 3;
    this.#bits[idx] = (this.#bits[idx] ?? 0) | (1 << (i & 7));
  }

  get(i: number): boolean {
    return ((this.#bits[i >>> 3] ?? 0) & (1 << (i & 7))) !== 0;
  }

  get bytes(): Uint8Array {
    return this.#bits;
  }

  count(): number {
    let total = 0;
    for (let byte of this.#bits) {
      while (byte) {
        byte &= byte - 1;
        total++;
      }
    }
    return total;
  }
}
