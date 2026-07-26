import { BitSet } from "../core/bitset.js";
import type { BytesLike } from "../core/bytes.js";
import { probeInto } from "../core/hasher.js";
import { FORMAT_VERSION, readHeader, writeHeader } from "../core/serialize.js";
import { optimal } from "../core/sizing.js";

const TYPE = 1;

export class BloomParamMismatchError extends Error {
  override readonly name = "BloomParamMismatchError";
}

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
  readonly #scratch: Uint32Array;
  #n: number;

  static create(n: number, epsilon: number): BloomFilter {
    const f = new BloomFilter(optimal(n, epsilon));
    f.#n = n;
    return f;
  }

  static fromBytes(bytes: Uint8Array): BloomFilter {
    const { body } = readHeader(bytes);
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const m = dv.getUint32(0, true);
    const k = body[4] ?? 0;
    const seed = dv.getUint32(5, true);
    const f = new BloomFilter({ m, k, seed });
    f.#bits.bytes.set(body.subarray(9));
    return f;
  }

  constructor({ m, k, seed = 0 }: BloomParams) {
    this.#bits = new BitSet(m);
    this.#m = m;
    this.#k = k;
    this.#seed = seed;
    this.#scratch = new Uint32Array(k);
    this.#n = Math.round((m * Math.LN2) / k);
  }

  /** Analytic design bits-per-key `m / n`. */
  get bitsPerKey(): number {
    return this.#m / this.#n;
  }

  toBytes(): Uint8Array {
    const payload = this.#bits.bytes;
    const body = new Uint8Array(9 + payload.length);
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    dv.setUint32(0, this.#m, true);
    body[4] = this.#k;
    dv.setUint32(5, this.#seed, true);
    body.set(payload, 9);
    return writeHeader({ version: FORMAT_VERSION, type: TYPE, flags: 0 }, body);
  }

  union(other: BloomFilter): BloomFilter {
    if (
      this.#m !== other.#m ||
      this.#k !== other.#k ||
      this.#seed !== other.#seed
    ) {
      throw new BloomParamMismatchError(
        "cannot union Bloom filters whose parameters do not match",
      );
    }
    const a = this.#bits.bytes;
    const b = other.#bits.bytes;
    const merged = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) merged[i] = (a[i] ?? 0) | (b[i] ?? 0);
    const r = new BloomFilter({ m: this.#m, k: this.#k, seed: this.#seed });
    r.#bits.bytes.set(merged);
    return r;
  }

  add(key: BytesLike): void {
    probeInto(key, this.#k, this.#m, this.#seed, this.#scratch);
    for (let i = 0; i < this.#k; i++) this.#bits.set(this.#scratch[i] ?? 0);
  }

  has(key: BytesLike): boolean {
    probeInto(key, this.#k, this.#m, this.#seed, this.#scratch);
    for (let i = 0; i < this.#k; i++) {
      if (!this.#bits.get(this.#scratch[i] ?? 0)) return false;
    }
    return true;
  }
}
