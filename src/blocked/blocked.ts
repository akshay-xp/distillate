import { normalize, type BytesLike } from "../core/bytes.js";
import { hash128, reduce } from "../core/hasher.js";

// Canonical split-block bit-position multipliers (Parquet/Impala): odd 32-bit
// constants that spread one 32-bit hash across the 8 lanes of a block.
const SALT = Uint32Array.of(
  0x47b6137b,
  0x44974d91,
  0x8824ad5b,
  0xa2b7289d,
  0x705495c7,
  0x2df1424b,
  0x9efc4947,
  0x5c6bfb31,
);

/**
 * Split-block probe: derive one block index and 8 single-bit lane masks for
 * `key`. Writes lane word indices into `outWords` and their masks into
 * `outBits` (both length 8, caller-owned so no per-call allocation). A block is
 * 256 bits = 8 contiguous 32-bit lanes; word `block*8 + i` gets one bit set.
 */
export interface BlockedBloomParams {
  bitsPerKey: number;
  capacity: number;
  seed?: number;
}

export class BlockedBloomFilter {
  readonly #lanes: Uint32Array;
  readonly #numBlocks: number;
  readonly #seed: number;
  readonly #n: number;
  readonly #words = new Uint32Array(8);
  readonly #bits = new Uint32Array(8);

  constructor({ bitsPerKey, capacity, seed = 0 }: BlockedBloomParams) {
    this.#numBlocks = Math.max(1, Math.ceil((bitsPerKey * capacity) / 256));
    this.#lanes = new Uint32Array(this.#numBlocks * 8);
    this.#seed = seed;
    this.#n = capacity;
  }

  get bitsPerKey(): number {
    return (this.#numBlocks * 256) / this.#n;
  }

  add(key: BytesLike): void {
    fillBlock(key, this.#numBlocks, this.#seed, this.#words, this.#bits);
    for (let i = 0; i < 8; i++) {
      const w = this.#words[i] ?? 0;
      this.#lanes[w] = (this.#lanes[w] ?? 0) | (this.#bits[i] ?? 0);
    }
  }

  has(key: BytesLike): boolean {
    fillBlock(key, this.#numBlocks, this.#seed, this.#words, this.#bits);
    for (let i = 0; i < 8; i++) {
      const bit = this.#bits[i] ?? 0;
      if (((this.#lanes[this.#words[i] ?? 0] ?? 0) & bit) >>> 0 !== bit)
        return false;
    }
    return true;
  }
}

export function fillBlock(
  key: BytesLike,
  numBlocks: number,
  seed: number,
  outWords: Uint32Array,
  outBits: Uint32Array,
): void {
  const { h1lo, h1hi, h2lo, h2hi } = hash128(normalize(key), seed);
  const block = reduce((h1lo ^ h1hi) >>> 0, numBlocks);
  const x = (h2lo ^ h2hi) >>> 0;
  const base = block * 8;
  for (let i = 0; i < 8; i++) {
    outWords[i] = base + i;
    outBits[i] = (1 << (Math.imul(x, SALT[i] ?? 0) >>> 27)) >>> 0;
  }
}
