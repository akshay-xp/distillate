import { normalize, type BytesLike } from "../core/bytes.js";
import { hash128 } from "../core/hasher.js";

const ARITY = 3;
const MAX_ATTEMPTS = 100;

export interface FuseParams {
  seg: number;
  segMask: number;
  segCountLen: number;
  arrayLength: number;
}

// Scratch output registers for the 64-bit-lane helpers, reused across calls
// (zero per-call allocation); safe because every helper is synchronous and
// non-recursive, and each caller captures RLO/RHI before the next helper runs.
let RLO = 0;
let RHI = 0;

function mul64(alo: number, ahi: number, blo: number, bhi: number): void {
  const a0 = alo & 0xffff;
  const a1 = alo >>> 16;
  const a2 = ahi & 0xffff;
  const a3 = ahi >>> 16;
  const b0 = blo & 0xffff;
  const b1 = blo >>> 16;
  const b2 = bhi & 0xffff;
  const b3 = bhi >>> 16;

  let c0 = a0 * b0;
  let c1 = c0 >>> 16;
  c0 &= 0xffff;

  c1 += a1 * b0;
  let c2 = c1 >>> 16;
  c1 &= 0xffff;
  c1 += a0 * b1;
  c2 += c1 >>> 16;
  c1 &= 0xffff;

  c2 += a2 * b0;
  let c3 = c2 >>> 16;
  c2 &= 0xffff;
  c2 += a1 * b1;
  c3 += c2 >>> 16;
  c2 &= 0xffff;
  c2 += a0 * b2;
  c3 += c2 >>> 16;
  c2 &= 0xffff;

  c3 += a3 * b0 + a2 * b1 + a1 * b2 + a0 * b3;
  c3 &= 0xffff;

  RLO = ((c1 << 16) | c0) >>> 0;
  RHI = ((c3 << 16) | c2) >>> 0;
}

// murmur3 fmix64 finalizer. Since every right shift is by 33 (>= 32), the
// shifted low word is (hi >>> 1) and the high word is 0.
function fmix64(lo: number, hi: number): void {
  let l = (lo ^ (hi >>> 1)) >>> 0;
  let h = hi;
  mul64(l, h, 0xed558ccd, 0xff51afd7);
  l = RLO;
  h = RHI;
  l = (l ^ (h >>> 1)) >>> 0;
  mul64(l, h, 0x1a85ec53, 0xc4ceb9fe);
  l = RLO;
  h = RHI;
  l = (l ^ (h >>> 1)) >>> 0;
  RLO = l;
  RHI = h;
}

// Cheaply perturb a stored 64-bit key hash with the attempt seed, avoiding a
// full re-hash of the key on every construction retry.
function mixSeed(lo: number, hi: number, seed: number): void {
  const l = (lo >>> 0) + (seed >>> 0);
  const carry = l > 0xffffffff ? 1 : 0;
  fmix64(l >>> 0, (hi + carry) >>> 0);
}

// High 32 bits of (hi:lo) * n, for n < 2^32: the 64-bit analogue of the
// Lemire multiply-shift reduction, mapping the hash into [0, n).
function mulhi64(lo: number, hi: number, n: number): number {
  mul64(hi, 0, n, 0);
  const aLo = RLO;
  const aHi = RHI;
  mul64(lo, 0, n, 0);
  const bHi = RHI;
  const carry = (aLo >>> 0) + (bHi >>> 0) > 0xffffffff ? 1 : 0;
  return (aHi + carry) >>> 0;
}

function positionsInto(
  mlo: number,
  mhi: number,
  seg: number,
  segMask: number,
  segCountLen: number,
  out: Uint32Array,
): void {
  const h0 = mulhi64(mlo, mhi, segCountLen);
  let h1 = (h0 + seg) >>> 0;
  let h2 = (h1 + seg) >>> 0;
  h1 = (h1 ^ (((mlo >>> 18) | (mhi << 14)) & segMask)) >>> 0;
  h2 = (h2 ^ (mlo & segMask)) >>> 0;
  out[0] = h0;
  out[1] = h1;
  out[2] = h2;
}

function fpMask(fp: Uint8Array | Uint16Array): number {
  return ((1 << (8 * fp.BYTES_PER_ELEMENT)) - 1) >>> 0;
}

export function computeParams(size: number): FuseParams {
  const seg = Math.min(
    1 << Math.floor(Math.log(size) / Math.log(3.33) + 2.25),
    1 << 18,
  );
  const segMask = seg - 1;
  const sizeFactor = Math.max(
    1.125,
    0.875 + (0.25 * Math.log(1e6)) / Math.log(Math.max(size, 2)),
  );
  const capacity = Math.round(size * sizeFactor);
  let segCount = Math.floor((capacity + seg - 1) / seg) - (ARITY - 1);
  if (segCount <= 0) segCount = 1;
  let arrayLength = (segCount + ARITY - 1) * seg;
  segCount = Math.floor((arrayLength + seg - 1) / seg) - (ARITY - 1);
  if (segCount <= 0) segCount = 1;
  arrayLength = (segCount + ARITY - 1) * seg;
  return { seg, segMask, segCountLen: segCount * seg, arrayLength };
}

/**
 * Peel the 3-hypergraph and assign fingerprints so every key's XOR of its 3
 * lanes equals its fingerprint. Retries with a bumped seed on a stall; returns
 * the seed that succeeded.
 */
export function buildFingerprints(
  fp: Uint8Array,
  hashes: Uint32Array,
  params: FuseParams,
): number {
  const size = hashes.length / 2;
  const { seg, segMask, segCountLen, arrayLength } = params;
  const mask = fpMask(fp);
  const counts = new Uint32Array(arrayLength);
  const xorLo = new Uint32Array(arrayLength);
  const xorHi = new Uint32Array(arrayLength);
  const orderLo = new Uint32Array(size);
  const orderHi = new Uint32Array(size);
  const orderIdx = new Uint32Array(size);
  const pos = new Uint32Array(3);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const seed = attempt;
    counts.fill(0);
    xorLo.fill(0);
    xorHi.fill(0);

    for (let i = 0; i < size; i++) {
      mixSeed(hashes[2 * i] ?? 0, hashes[2 * i + 1] ?? 0, seed);
      const mlo = RLO;
      const mhi = RHI;
      positionsInto(mlo, mhi, seg, segMask, segCountLen, pos);
      for (let j = 0; j < 3; j++) {
        const p = pos[j] ?? 0;
        counts[p] = (counts[p] ?? 0) + 1;
        xorLo[p] = (xorLo[p] ?? 0) ^ mlo;
        xorHi[p] = (xorHi[p] ?? 0) ^ mhi;
      }
    }

    const queue: number[] = [];
    for (let idx = 0; idx < arrayLength; idx++) {
      if ((counts[idx] ?? 0) === 1) queue.push(idx);
    }

    let processed = 0;
    while (queue.length > 0) {
      const idx = queue.pop();
      if (idx === undefined) break;
      if ((counts[idx] ?? 0) !== 1) continue;
      const mlo = xorLo[idx] ?? 0;
      const mhi = xorHi[idx] ?? 0;
      orderLo[processed] = mlo;
      orderHi[processed] = mhi;
      orderIdx[processed] = idx;
      processed++;
      positionsInto(mlo, mhi, seg, segMask, segCountLen, pos);
      for (let j = 0; j < 3; j++) {
        const p = pos[j] ?? 0;
        counts[p] = (counts[p] ?? 0) - 1;
        xorLo[p] = (xorLo[p] ?? 0) ^ mlo;
        xorHi[p] = (xorHi[p] ?? 0) ^ mhi;
        if ((counts[p] ?? 0) === 1) queue.push(p);
      }
    }

    if (processed === size) {
      fp.fill(0);
      for (let i = processed - 1; i >= 0; i--) {
        const mlo = orderLo[i] ?? 0;
        const mhi = orderHi[i] ?? 0;
        const idx = orderIdx[i] ?? 0;
        positionsInto(mlo, mhi, seg, segMask, segCountLen, pos);
        const p0 = pos[0] ?? 0;
        const p1 = pos[1] ?? 0;
        const p2 = pos[2] ?? 0;
        fp[idx] =
          (((mlo ^ mhi) & mask) ^
            (fp[p0] ?? 0) ^
            (fp[p1] ?? 0) ^
            (fp[p2] ?? 0)) &
          mask;
      }
      return seed;
    }
  }

  throw new Error("binary fuse construction failed");
}

export class BinaryFuse8 {
  readonly #fp: Uint8Array;
  readonly #seed: number;
  readonly #seg: number;
  readonly #segMask: number;
  readonly #segCountLen: number;
  readonly #pos = new Uint32Array(3);

  private constructor(fp: Uint8Array, seed: number, params: FuseParams) {
    this.#fp = fp;
    this.#seed = seed;
    this.#seg = params.seg;
    this.#segMask = params.segMask;
    this.#segCountLen = params.segCountLen;
  }

  static from(keys: Iterable<BytesLike>): BinaryFuse8 {
    const hashList: number[] = [];
    for (const key of keys) {
      const { h1lo, h1hi } = hash128(normalize(key), 0);
      hashList.push(h1lo >>> 0, h1hi >>> 0);
    }
    const size = hashList.length / 2;
    const hashes = Uint32Array.from(hashList);
    const params = computeParams(size);
    const fp = new Uint8Array(params.arrayLength);
    const seed = buildFingerprints(fp, hashes, params);
    return new BinaryFuse8(fp, seed, params);
  }

  has(key: BytesLike): boolean {
    const { h1lo, h1hi } = hash128(normalize(key), 0);
    mixSeed(h1lo >>> 0, h1hi >>> 0, this.#seed);
    const mlo = RLO;
    const mhi = RHI;
    positionsInto(
      mlo,
      mhi,
      this.#seg,
      this.#segMask,
      this.#segCountLen,
      this.#pos,
    );
    const mask = fpMask(this.#fp);
    const p0 = this.#pos[0] ?? 0;
    const p1 = this.#pos[1] ?? 0;
    const p2 = this.#pos[2] ?? 0;
    return (
      ((mlo ^ mhi) & mask) ===
      (((this.#fp[p0] ?? 0) ^ (this.#fp[p1] ?? 0) ^ (this.#fp[p2] ?? 0)) & mask)
    );
  }
}
