import { normalize, type BytesLike } from "./bytes.js";

export interface Hash128 {
  h1lo: number;
  h1hi: number;
  h2lo: number;
  h2hi: number;
}

const C1LO = 0x114253d5;
const C1HI = 0x87c37b91;
const C2LO = 0x2745937f;
const C2HI = 0x4cf5ad43;

// Scratch output registers for the 64-bit-lane helpers below. Reused across
// calls (zero per-call allocation); safe because hash128 is synchronous and
// non-recursive, so no call observes another's registers mid-computation.
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

function rotl64(lo: number, hi: number, r: number): void {
  if (r < 32) {
    RLO = ((lo << r) | (hi >>> (32 - r))) >>> 0;
    RHI = ((hi << r) | (lo >>> (32 - r))) >>> 0;
  } else {
    const s = r - 32;
    RLO = ((hi << s) | (lo >>> (32 - s))) >>> 0;
    RHI = ((lo << s) | (hi >>> (32 - s))) >>> 0;
  }
}

function add64(alo: number, ahi: number, blo: number, bhi: number): void {
  const lo = (alo >>> 0) + (blo >>> 0);
  RHI = (ahi + bhi + (lo > 0xffffffff ? 1 : 0)) >>> 0;
  RLO = lo >>> 0;
}

function fmix64(lo: number, hi: number): void {
  let l = lo;
  let h = hi;
  // k ^= k >>> 33: since 33 >= 32, the shifted low word is (hi >>> 1), high 0.
  l = (l ^ (h >>> 1)) >>> 0;
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

export function hash128(bytes: Uint8Array, seed = 0): Hash128 {
  const len = bytes.length;
  const nblocks = len >>> 4;

  let h1lo = seed >>> 0;
  let h1hi = 0;
  let h2lo = seed >>> 0;
  let h2hi = 0;

  for (let i = 0; i < nblocks; i++) {
    const b = i * 16;
    let k1lo =
      ((bytes[b] ?? 0) |
        ((bytes[b + 1] ?? 0) << 8) |
        ((bytes[b + 2] ?? 0) << 16) |
        ((bytes[b + 3] ?? 0) << 24)) >>>
      0;
    let k1hi =
      ((bytes[b + 4] ?? 0) |
        ((bytes[b + 5] ?? 0) << 8) |
        ((bytes[b + 6] ?? 0) << 16) |
        ((bytes[b + 7] ?? 0) << 24)) >>>
      0;
    let k2lo =
      ((bytes[b + 8] ?? 0) |
        ((bytes[b + 9] ?? 0) << 8) |
        ((bytes[b + 10] ?? 0) << 16) |
        ((bytes[b + 11] ?? 0) << 24)) >>>
      0;
    let k2hi =
      ((bytes[b + 12] ?? 0) |
        ((bytes[b + 13] ?? 0) << 8) |
        ((bytes[b + 14] ?? 0) << 16) |
        ((bytes[b + 15] ?? 0) << 24)) >>>
      0;

    mul64(k1lo, k1hi, C1LO, C1HI);
    rotl64(RLO, RHI, 31);
    mul64(RLO, RHI, C2LO, C2HI);
    k1lo = RLO;
    k1hi = RHI;
    h1lo ^= k1lo;
    h1hi ^= k1hi;

    rotl64(h1lo, h1hi, 27);
    add64(RLO, RHI, h2lo, h2hi);
    mul64(RLO, RHI, 5, 0);
    add64(RLO, RHI, 0x52dce729, 0);
    h1lo = RLO;
    h1hi = RHI;

    mul64(k2lo, k2hi, C2LO, C2HI);
    rotl64(RLO, RHI, 33);
    mul64(RLO, RHI, C1LO, C1HI);
    k2lo = RLO;
    k2hi = RHI;
    h2lo ^= k2lo;
    h2hi ^= k2hi;

    rotl64(h2lo, h2hi, 31);
    add64(RLO, RHI, h1lo, h1hi);
    mul64(RLO, RHI, 5, 0);
    add64(RLO, RHI, 0x38495ab5, 0);
    h2lo = RLO;
    h2hi = RHI;
  }

  let k1lo = 0;
  let k1hi = 0;
  let k2lo = 0;
  let k2hi = 0;
  const tail = nblocks * 16;
  const rem = len & 15;

  if (rem >= 15) k2hi ^= (bytes[tail + 14] ?? 0) << 16;
  if (rem >= 14) k2hi ^= (bytes[tail + 13] ?? 0) << 8;
  if (rem >= 13) k2hi ^= bytes[tail + 12] ?? 0;
  if (rem >= 12) k2lo ^= (bytes[tail + 11] ?? 0) << 24;
  if (rem >= 11) k2lo ^= (bytes[tail + 10] ?? 0) << 16;
  if (rem >= 10) k2lo ^= (bytes[tail + 9] ?? 0) << 8;
  if (rem >= 9) {
    k2lo ^= bytes[tail + 8] ?? 0;
    k2lo >>>= 0;
    k2hi >>>= 0;
    mul64(k2lo, k2hi, C2LO, C2HI);
    rotl64(RLO, RHI, 33);
    mul64(RLO, RHI, C1LO, C1HI);
    h2lo ^= RLO;
    h2hi ^= RHI;
  }

  if (rem >= 8) k1hi ^= (bytes[tail + 7] ?? 0) << 24;
  if (rem >= 7) k1hi ^= (bytes[tail + 6] ?? 0) << 16;
  if (rem >= 6) k1hi ^= (bytes[tail + 5] ?? 0) << 8;
  if (rem >= 5) k1hi ^= bytes[tail + 4] ?? 0;
  if (rem >= 4) k1lo ^= (bytes[tail + 3] ?? 0) << 24;
  if (rem >= 3) k1lo ^= (bytes[tail + 2] ?? 0) << 16;
  if (rem >= 2) k1lo ^= (bytes[tail + 1] ?? 0) << 8;
  if (rem >= 1) {
    k1lo ^= bytes[tail] ?? 0;
    k1lo >>>= 0;
    k1hi >>>= 0;
    mul64(k1lo, k1hi, C1LO, C1HI);
    rotl64(RLO, RHI, 31);
    mul64(RLO, RHI, C2LO, C2HI);
    h1lo ^= RLO;
    h1hi ^= RHI;
  }

  h1lo = (h1lo ^ len) >>> 0;
  h2lo = (h2lo ^ len) >>> 0;

  add64(h1lo, h1hi, h2lo, h2hi);
  h1lo = RLO;
  h1hi = RHI;
  add64(h2lo, h2hi, h1lo, h1hi);
  h2lo = RLO;
  h2hi = RHI;

  fmix64(h1lo, h1hi);
  h1lo = RLO;
  h1hi = RHI;
  fmix64(h2lo, h2hi);
  h2lo = RLO;
  h2hi = RHI;

  add64(h1lo, h1hi, h2lo, h2hi);
  h1lo = RLO;
  h1hi = RHI;
  add64(h2lo, h2hi, h1lo, h1hi);
  h2lo = RLO;
  h2hi = RHI;

  return {
    h1lo: h1lo >>> 0,
    h1hi: h1hi >>> 0,
    h2lo: h2lo >>> 0,
    h2hi: h2hi >>> 0,
  };
}

// Lemire multiply-shift: map x in [0, 2^32) to [0, range) via the high 32 bits
// of x * range, computed with 16-bit partial products (no 64-bit overflow).
export function reduce(x: number, range: number): number {
  const xlo = x & 0xffff;
  const xhi = x >>> 16;
  const rlo = range & 0xffff;
  const rhi = range >>> 16;
  const lolo = xlo * rlo;
  const lohi = xlo * rhi;
  const hilo = xhi * rlo;
  const hihi = xhi * rhi;
  const carry = (lolo >>> 16) + (lohi & 0xffff) + (hilo & 0xffff);
  return (hihi + (lohi >>> 16) + (hilo >>> 16) + (carry >>> 16)) >>> 0;
}

/**
 * Derive `count` bucket indices in `[0, range)` from a key using
 * Kirsch-Mitzenmacher enhanced double hashing `g_i = h1 + i*h2 + i^2`
 * (the RocksDB `+i^2` fix), reduced into range with Lemire multiply-shift.
 */
export function probeInto(
  key: BytesLike,
  count: number,
  range: number,
  seed: number,
  out: Uint32Array,
): void {
  const { h1lo, h1hi, h2lo, h2hi } = hash128(normalize(key), seed);
  const a = (h1lo ^ h1hi) >>> 0;
  const b = (h2lo ^ h2hi) >>> 0;
  for (let i = 0; i < count; i++) {
    const x = (a + Math.imul(i, b) + i * i) >>> 0;
    out[i] = reduce(x, range);
  }
}

export function probes(
  key: BytesLike,
  count: number,
  range: number,
  seed = 0,
): Uint32Array {
  const out = new Uint32Array(count);
  probeInto(key, count, range, seed, out);
  return out;
}
