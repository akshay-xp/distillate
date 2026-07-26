export class BitSet {
  readonly #bits: Uint8Array;

  constructor(nbits: number) {
    this.#bits = new Uint8Array(Math.ceil(nbits / 8));
  }

  set(i: number): void {
    const idx = i >>> 3;
    this.#bits[idx] = (this.#bits[idx] ?? 0) | (1 << (i & 7));
  }

  get(i: number): boolean {
    return ((this.#bits[i >>> 3] ?? 0) & (1 << (i & 7))) !== 0;
  }
}
