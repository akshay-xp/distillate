import { BitSet } from "../core/bitset.js";
import type { BytesLike } from "../core/bytes.js";
import { probes } from "../core/hasher.js";

export interface BloomParams {
  m: number;
  k: number;
  seed?: number;
}

export class BloomFilter {
  readonly #bits: BitSet;
  readonly #m: number;
  readonly #k: number;
  readonly #seed: number;

  constructor({ m, k, seed = 0 }: BloomParams) {
    this.#bits = new BitSet(m);
    this.#m = m;
    this.#k = k;
    this.#seed = seed;
  }

  add(key: BytesLike): void {
    for (const i of probes(key, this.#k, this.#m, this.#seed))
      this.#bits.set(i);
  }

  has(key: BytesLike): boolean {
    for (const i of probes(key, this.#k, this.#m, this.#seed)) {
      if (!this.#bits.get(i)) return false;
    }
    return true;
  }
}
