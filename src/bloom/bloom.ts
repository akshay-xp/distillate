import { BitSet } from "../core/bitset.js";
import type { BytesLike } from "../core/bytes.js";
import { probes } from "../core/hasher.js";
import { optimal } from "../core/sizing.js";

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
  #n: number;

  static create(n: number, epsilon: number): BloomFilter {
    const f = new BloomFilter(optimal(n, epsilon));
    f.#n = n;
    return f;
  }

  constructor({ m, k, seed = 0 }: BloomParams) {
    this.#bits = new BitSet(m);
    this.#m = m;
    this.#k = k;
    this.#seed = seed;
    this.#n = Math.round((m * Math.LN2) / k);
  }

  /** Analytic design bits-per-key `m / n`. */
  get bitsPerKey(): number {
    return this.#m / this.#n;
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
