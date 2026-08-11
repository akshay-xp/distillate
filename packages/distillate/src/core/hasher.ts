import { normalize, type BytesLike } from "./bytes.js";

export interface Hash128 {
  w0: number;
  w1: number;
  w2: number;
  w3: number;
}

// Scratch output registers for the 64-bit-lane helpers below. Reused across
// calls (zero per-call allocation); safe because hash128 is synchronous and
// non-recursive, so no call observes another's registers mid-computation.
export let RLO = 0;
export let RHI = 0;

// Reused output struct for the final hash lanes, same non-reentrant rationale
// as RLO/RHI. computeLanes writes it; the allocating wrappers copy it out.
const LANES: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };

export function mul64(
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): void {
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

export function fmix64(lo: number, hi: number): void {
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

function rotl32(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

function fmix32(h: number): number {
  let x = h;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

// murmur3_x86_128: pure 32-bit (Math.imul), one pass over the key, four output
// words. One hash for the whole library: Bloom/Blocked read two words as the
// double-hash a/b; Fuse reads the first 64-bit lane (w0/w1). No emulated
// 64-bit multiply, so it is fast on V8 for every structure.
const K1 = 0x239b961b;
const K2 = 0xab0e9789;
const K3 = 0x38b34ae5;
const K4 = 0xa1e38b93;

function computeLanes(bytes: Uint8Array, seed: number, len: number): void {
  const nblocks = len >>> 4;

  let h1 = seed >>> 0;
  let h2 = seed >>> 0;
  let h3 = seed >>> 0;
  let h4 = seed >>> 0;

  for (let i = 0; i < nblocks; i++) {
    const b = i * 16;
    let k1 =
      ((bytes[b] ?? 0) |
        ((bytes[b + 1] ?? 0) << 8) |
        ((bytes[b + 2] ?? 0) << 16) |
        ((bytes[b + 3] ?? 0) << 24)) >>>
      0;
    let k2 =
      ((bytes[b + 4] ?? 0) |
        ((bytes[b + 5] ?? 0) << 8) |
        ((bytes[b + 6] ?? 0) << 16) |
        ((bytes[b + 7] ?? 0) << 24)) >>>
      0;
    let k3 =
      ((bytes[b + 8] ?? 0) |
        ((bytes[b + 9] ?? 0) << 8) |
        ((bytes[b + 10] ?? 0) << 16) |
        ((bytes[b + 11] ?? 0) << 24)) >>>
      0;
    let k4 =
      ((bytes[b + 12] ?? 0) |
        ((bytes[b + 13] ?? 0) << 8) |
        ((bytes[b + 14] ?? 0) << 16) |
        ((bytes[b + 15] ?? 0) << 24)) >>>
      0;

    k1 = Math.imul(rotl32(Math.imul(k1, K1), 15), K2);
    h1 ^= k1;
    h1 = rotl32(h1, 19);
    h1 = (h1 + h2) >>> 0;
    h1 = (Math.imul(h1, 5) + 0x561ccd1b) >>> 0;

    k2 = Math.imul(rotl32(Math.imul(k2, K2), 16), K3);
    h2 ^= k2;
    h2 = rotl32(h2, 17);
    h2 = (h2 + h3) >>> 0;
    h2 = (Math.imul(h2, 5) + 0x0bcaa747) >>> 0;

    k3 = Math.imul(rotl32(Math.imul(k3, K3), 17), K4);
    h3 ^= k3;
    h3 = rotl32(h3, 15);
    h3 = (h3 + h4) >>> 0;
    h3 = (Math.imul(h3, 5) + 0x96cd1c35) >>> 0;

    k4 = Math.imul(rotl32(Math.imul(k4, K4), 18), K1);
    h4 ^= k4;
    h4 = rotl32(h4, 13);
    h4 = (h4 + h1) >>> 0;
    h4 = (Math.imul(h4, 5) + 0x32ac3b17) >>> 0;
  }

  let k1 = 0;
  let k2 = 0;
  let k3 = 0;
  let k4 = 0;
  const tail = nblocks * 16;
  const rem = len & 15;

  if (rem >= 15) k4 ^= (bytes[tail + 14] ?? 0) << 16;
  if (rem >= 14) k4 ^= (bytes[tail + 13] ?? 0) << 8;
  if (rem >= 13) {
    k4 ^= bytes[tail + 12] ?? 0;
    k4 = Math.imul(rotl32(Math.imul(k4, K4), 18), K1);
    h4 ^= k4;
  }
  if (rem >= 12) k3 ^= (bytes[tail + 11] ?? 0) << 24;
  if (rem >= 11) k3 ^= (bytes[tail + 10] ?? 0) << 16;
  if (rem >= 10) k3 ^= (bytes[tail + 9] ?? 0) << 8;
  if (rem >= 9) {
    k3 ^= bytes[tail + 8] ?? 0;
    k3 = Math.imul(rotl32(Math.imul(k3, K3), 17), K4);
    h3 ^= k3;
  }
  if (rem >= 8) k2 ^= (bytes[tail + 7] ?? 0) << 24;
  if (rem >= 7) k2 ^= (bytes[tail + 6] ?? 0) << 16;
  if (rem >= 6) k2 ^= (bytes[tail + 5] ?? 0) << 8;
  if (rem >= 5) {
    k2 ^= bytes[tail + 4] ?? 0;
    k2 = Math.imul(rotl32(Math.imul(k2, K2), 16), K3);
    h2 ^= k2;
  }
  if (rem >= 4) k1 ^= (bytes[tail + 3] ?? 0) << 24;
  if (rem >= 3) k1 ^= (bytes[tail + 2] ?? 0) << 16;
  if (rem >= 2) k1 ^= (bytes[tail + 1] ?? 0) << 8;
  if (rem >= 1) {
    k1 ^= bytes[tail] ?? 0;
    k1 = Math.imul(rotl32(Math.imul(k1, K1), 15), K2);
    h1 ^= k1;
  }

  h1 = (h1 ^ len) >>> 0;
  h2 = (h2 ^ len) >>> 0;
  h3 = (h3 ^ len) >>> 0;
  h4 = (h4 ^ len) >>> 0;

  h1 = (h1 + h2) >>> 0;
  h1 = (h1 + h3) >>> 0;
  h1 = (h1 + h4) >>> 0;
  h2 = (h2 + h1) >>> 0;
  h3 = (h3 + h1) >>> 0;
  h4 = (h4 + h1) >>> 0;

  h1 = fmix32(h1);
  h2 = fmix32(h2);
  h3 = fmix32(h3);
  h4 = fmix32(h4);

  h1 = (h1 + h2) >>> 0;
  h1 = (h1 + h3) >>> 0;
  h1 = (h1 + h4) >>> 0;
  h2 = (h2 + h1) >>> 0;
  h3 = (h3 + h1) >>> 0;
  h4 = (h4 + h1) >>> 0;

  LANES.w0 = h1;
  LANES.w1 = h2;
  LANES.w2 = h3;
  LANES.w3 = h4;
}

export function hash128(
  bytes: Uint8Array,
  seed = 0,
  len: number = bytes.length,
): Hash128 {
  computeLanes(bytes, seed, len);
  return { ...LANES };
}

const keyEncoder = new TextEncoder();
let keyBuf = new Uint8Array(256);

// Reused view of the encoded key, set by encodeKey; zero per-call allocation.
let encBytes: Uint8Array = keyBuf;
let encLen = 0;

// Encode a key to bytes with zero per-call allocation: strings encode into a
// reused buffer (grown on demand); byte inputs are used directly. Result is
// exposed via the module-scope encBytes/encLen, read immediately by callers.
function encodeKey(key: BytesLike): void {
  if (typeof key === "string") {
    const cap = key.length * 3;
    if (keyBuf.length < cap) keyBuf = new Uint8Array(cap);
    encLen = keyEncoder.encodeInto(key, keyBuf).written;
    encBytes = keyBuf;
    return;
  }
  encBytes = normalize(key);
  encLen = encBytes.length;
}

function keyToLanes(key: BytesLike, seed: number): void {
  encodeKey(key);
  computeLanes(encBytes, seed, encLen);
}

export function hash128Key(key: BytesLike, seed = 0): Hash128 {
  keyToLanes(key, seed);
  return { ...LANES };
}

// Zero-alloc key hashing for hot paths: fills a caller-owned struct instead of
// returning a fresh object.
export function hash128KeyInto(
  key: BytesLike,
  seed: number,
  out: Hash128,
): void {
  keyToLanes(key, seed);
  out.w0 = LANES.w0;
  out.w1 = LANES.w1;
  out.w2 = LANES.w2;
  out.w3 = LANES.w3;
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

// Two independent 32-bit hashes of `key`, written to out[0]/out[1]. One key
// encode, one murmur3_x86_128 pass; the first two output words are the two
// independent double-hash words. Zero per-call allocation.
export function hash32x2Into(
  key: BytesLike,
  seed: number,
  out: Uint32Array,
): void {
  keyToLanes(key, seed);
  out[0] = LANES.w0;
  out[1] = LANES.w1;
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
  keyToLanes(key, seed);
  const a = LANES.w0;
  const b = LANES.w1;
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
