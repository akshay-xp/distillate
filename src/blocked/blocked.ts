import { type BytesLike } from "../core/bytes.js";
import { type Hash128, hash128KeyInto, reduce } from "../core/hasher.js";
import { FORMAT_VERSION, readHeader, writeHeader } from "../core/serialize.js";

const TYPE = 2;

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

// Reused across fillBlock calls; safe because hashing is synchronous and
// non-reentrant (same rationale as the hasher's own scratch registers).
const scratchHash: Hash128 = { h1lo: 0, h1hi: 0, h2lo: 0, h2hi: 0 };

/**
 * Split-block probe: derive one block index and 8 single-bit lane masks for
 * `key`. Writes lane word indices into `outWords` and their masks into
 * `outBits` (both length 8, caller-owned so no per-call allocation). A block is
 * 256 bits = 8 contiguous 32-bit lanes; word `block*8 + i` gets one bit set.
 */
export class BlockedBloomParamMismatchError extends Error {
  override readonly name = "BlockedBloomParamMismatchError";
}

export interface BlockedBloomParams {
  bitsPerKey: number;
  capacity: number;
  seed?: number;
}

export class BlockedBloomFilter {
  readonly #lanes: Uint32Array;
  readonly #numBlocks: number;
  readonly #seed: number;
  #n: number;
  readonly #words = new Uint32Array(8);
  readonly #bits = new Uint32Array(8);

  // Bits-per-key vs target FPR for split-block (8 lanes, 256-bit blocks),
  // as (log10(1/epsilon), bitsPerKey). Carries the clustering penalty of
  // confining all probes to one block. Source: Parquet split-block table.
  static #ANCHORS: readonly [number, number][] = [
    [2, 10.5],
    [3, 16.9],
    [4, 26.4],
  ];

  static create(n: number, epsilon: number): BlockedBloomFilter {
    const t = Math.log10(1 / epsilon);
    const a = BlockedBloomFilter.#ANCHORS;
    // Segment to interpolate on: the first whose upper anchor is >= t;
    // clamped to a real segment so t outside the anchors extrapolates.
    let seg = a.findIndex((p) => t <= p[0]);
    if (seg < 1) seg = seg === -1 ? a.length - 1 : 1;
    const [t0, b0] = a[seg - 1] ?? [0, 0];
    const [t1, b1] = a[seg] ?? [0, 0];
    const bitsPerKey = b0 + ((b1 - b0) / (t1 - t0)) * (t - t0);
    return new BlockedBloomFilter({
      bitsPerKey: Math.ceil(bitsPerKey),
      capacity: n,
    });
  }

  constructor({ bitsPerKey, capacity, seed = 0 }: BlockedBloomParams) {
    this.#numBlocks = Math.max(1, Math.ceil((bitsPerKey * capacity) / 256));
    this.#lanes = new Uint32Array(this.#numBlocks * 8);
    this.#seed = seed;
    this.#n = capacity;
  }

  get bitsPerKey(): number {
    return (this.#numBlocks * 256) / this.#n;
  }

  static fromBytes(bytes: Uint8Array): BlockedBloomFilter {
    const { body } = readHeader(bytes);
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const numBlocks = dv.getUint32(0, true);
    const seed = dv.getUint32(4, true);
    const n = dv.getUint32(8, true);
    // bitsPerKey 256 with capacity=numBlocks reconstructs exactly numBlocks
    // blocks (256*numBlocks/256); #n is then restored to the stored capacity.
    const f = new BlockedBloomFilter({
      bitsPerKey: 256,
      capacity: numBlocks,
      seed,
    });
    f.#n = n;
    new Uint8Array(f.#lanes.buffer).set(body.subarray(12));
    return f;
  }

  toBytes(): Uint8Array {
    const lanes = new Uint8Array(
      this.#lanes.buffer,
      this.#lanes.byteOffset,
      this.#lanes.byteLength,
    );
    const body = new Uint8Array(12 + lanes.length);
    const dv = new DataView(body.buffer);
    dv.setUint32(0, this.#numBlocks, true);
    dv.setUint32(4, this.#seed, true);
    dv.setUint32(8, this.#n, true);
    body.set(lanes, 12);
    return writeHeader({ version: FORMAT_VERSION, type: TYPE, flags: 0 }, body);
  }

  union(other: BlockedBloomFilter): BlockedBloomFilter {
    if (this.#numBlocks !== other.#numBlocks || this.#seed !== other.#seed) {
      throw new BlockedBloomParamMismatchError(
        "cannot union blocked Bloom filters whose parameters do not match",
      );
    }
    const r = new BlockedBloomFilter({
      bitsPerKey: this.bitsPerKey,
      capacity: this.#n,
      seed: this.#seed,
    });
    for (let i = 0; i < this.#lanes.length; i++)
      r.#lanes[i] = (this.#lanes[i] ?? 0) | (other.#lanes[i] ?? 0);
    return r;
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
  hash128KeyInto(key, seed, scratchHash);
  const block = reduce((scratchHash.h1lo ^ scratchHash.h1hi) >>> 0, numBlocks);
  const x = (scratchHash.h2lo ^ scratchHash.h2hi) >>> 0;
  const base = block * 8;
  for (let i = 0; i < 8; i++) {
    outWords[i] = base + i;
    outBits[i] = (1 << (Math.imul(x, SALT[i] ?? 0) >>> 27)) >>> 0;
  }
}
