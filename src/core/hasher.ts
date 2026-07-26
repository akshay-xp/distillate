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

interface Lane {
  lo: number;
  hi: number;
}

function add64(a: Lane, b: Lane): void {
  const lo = (a.lo >>> 0) + (b.lo >>> 0);
  a.hi = (a.hi + b.hi + (lo > 0xffffffff ? 1 : 0)) >>> 0;
  a.lo = lo >>> 0;
}

function mul64(a: Lane, blo: number, bhi: number): void {
  const a0 = a.lo & 0xffff;
  const a1 = a.lo >>> 16;
  const a2 = a.hi & 0xffff;
  const a3 = a.hi >>> 16;
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

  a.lo = ((c1 << 16) | c0) >>> 0;
  a.hi = ((c3 << 16) | c2) >>> 0;
}

function rotl64(a: Lane, r: number): void {
  const { lo, hi } = a;
  if (r < 32) {
    a.lo = ((lo << r) | (hi >>> (32 - r))) >>> 0;
    a.hi = ((hi << r) | (lo >>> (32 - r))) >>> 0;
  } else {
    const s = r - 32;
    a.lo = ((hi << s) | (lo >>> (32 - s))) >>> 0;
    a.hi = ((lo << s) | (hi >>> (32 - s))) >>> 0;
  }
}

// k ^= k >>> 33: since 33 >= 32, the shifted value's low word is (hi >>> 1)
// and its high word is 0.
function xorShift33(a: Lane): void {
  a.lo = (a.lo ^ (a.hi >>> 1)) >>> 0;
}

function fmix64(a: Lane): void {
  xorShift33(a);
  mul64(a, 0xed558ccd, 0xff51afd7);
  xorShift33(a);
  mul64(a, 0x1a85ec53, 0xc4ceb9fe);
  xorShift33(a);
}

export function hash128(bytes: Uint8Array, seed = 0): Hash128 {
  const len = bytes.length;
  const nblocks = len >>> 4;
  const view = new DataView(bytes.buffer, bytes.byteOffset, len);

  const h1: Lane = { lo: seed >>> 0, hi: 0 };
  const h2: Lane = { lo: seed >>> 0, hi: 0 };
  const k1: Lane = { lo: 0, hi: 0 };
  const k2: Lane = { lo: 0, hi: 0 };

  for (let i = 0; i < nblocks; i++) {
    const b = i * 16;
    k1.lo = view.getUint32(b, true);
    k1.hi = view.getUint32(b + 4, true);
    k2.lo = view.getUint32(b + 8, true);
    k2.hi = view.getUint32(b + 12, true);

    mul64(k1, C1LO, C1HI);
    rotl64(k1, 31);
    mul64(k1, C2LO, C2HI);
    h1.lo ^= k1.lo;
    h1.hi ^= k1.hi;

    rotl64(h1, 27);
    add64(h1, h2);
    mul64(h1, 5, 0);
    add64(h1, { lo: 0x52dce729, hi: 0 });

    mul64(k2, C2LO, C2HI);
    rotl64(k2, 33);
    mul64(k2, C1LO, C1HI);
    h2.lo ^= k2.lo;
    h2.hi ^= k2.hi;

    rotl64(h2, 31);
    add64(h2, h1);
    mul64(h2, 5, 0);
    add64(h2, { lo: 0x38495ab5, hi: 0 });
  }

  k1.lo = 0;
  k1.hi = 0;
  k2.lo = 0;
  k2.hi = 0;
  const tail = nblocks * 16;
  const rem = len & 15;

  if (rem >= 15) k2.hi ^= view.getUint8(tail + 14) << 16;
  if (rem >= 14) k2.hi ^= view.getUint8(tail + 13) << 8;
  if (rem >= 13) k2.hi ^= view.getUint8(tail + 12);
  if (rem >= 12) k2.lo ^= view.getUint8(tail + 11) << 24;
  if (rem >= 11) k2.lo ^= view.getUint8(tail + 10) << 16;
  if (rem >= 10) k2.lo ^= view.getUint8(tail + 9) << 8;
  if (rem >= 9) {
    k2.lo ^= view.getUint8(tail + 8);
    k2.lo >>>= 0;
    k2.hi >>>= 0;
    mul64(k2, C2LO, C2HI);
    rotl64(k2, 33);
    mul64(k2, C1LO, C1HI);
    h2.lo ^= k2.lo;
    h2.hi ^= k2.hi;
  }

  if (rem >= 8) k1.hi ^= view.getUint8(tail + 7) << 24;
  if (rem >= 7) k1.hi ^= view.getUint8(tail + 6) << 16;
  if (rem >= 6) k1.hi ^= view.getUint8(tail + 5) << 8;
  if (rem >= 5) k1.hi ^= view.getUint8(tail + 4);
  if (rem >= 4) k1.lo ^= view.getUint8(tail + 3) << 24;
  if (rem >= 3) k1.lo ^= view.getUint8(tail + 2) << 16;
  if (rem >= 2) k1.lo ^= view.getUint8(tail + 1) << 8;
  if (rem >= 1) {
    k1.lo ^= view.getUint8(tail);
    k1.lo >>>= 0;
    k1.hi >>>= 0;
    mul64(k1, C1LO, C1HI);
    rotl64(k1, 31);
    mul64(k1, C2LO, C2HI);
    h1.lo ^= k1.lo;
    h1.hi ^= k1.hi;
  }

  h1.lo = (h1.lo ^ len) >>> 0;
  h2.lo = (h2.lo ^ len) >>> 0;

  add64(h1, h2);
  add64(h2, h1);

  fmix64(h1);
  fmix64(h2);

  add64(h1, h2);
  add64(h2, h1);

  return {
    h1lo: h1.lo >>> 0,
    h1hi: h1.hi >>> 0,
    h2lo: h2.lo >>> 0,
    h2hi: h2.hi >>> 0,
  };
}
