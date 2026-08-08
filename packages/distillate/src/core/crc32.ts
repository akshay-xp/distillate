// Slice-by-8 (Intel/zlib): eight 256-entry tables consumed 8 bytes per
// iteration. Identical IEEE 802.3 output to the byte-at-a-time loop, ~1 GB/s.
// Tables are laid out flat in one Uint32Array; table k occupies [k*256, k*256+256).
const T1 = 256;
const T2 = 512;
const T3 = 768;
const T4 = 1024;
const T5 = 1280;
const T6 = 1536;
const T7 = 1792;

// noUncheckedIndexedAccess widens every element read to `number | undefined`.
// All indices here are provably in range (0-255 nibbles), so read through this
// helper: V8 keeps it a direct read, and the one nullish guard stays in one place
// instead of scattering `?? 0` across the hot path. Bytes are read via DataView,
// whose getUint8/getUint32 already return a plain `number`.
const at = (a: Uint32Array, i: number): number => a[i] ?? 0;

let tables: Uint32Array | undefined;

function buildTables(): Uint32Array {
  const t = new Uint32Array(8 * 256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  // T[k][n] = (T[k-1][n] >>> 8) ^ T[0][T[k-1][n] & 0xff]
  for (let k = 1; k < 8; k++) {
    for (let n = 0; n < 256; n++) {
      const p = at(t, (k - 1) * 256 + n);
      t[k * 256 + n] = (at(t, p & 0xff) ^ (p >>> 8)) >>> 0;
    }
  }
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = (tables ??= buildTables());
  const len = bytes.length;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let crc = 0xffffffff;
  let i = 0;
  const last = len - 8;
  while (i <= last) {
    const one = (dv.getUint32(i, true) ^ crc) >>> 0;
    const two = dv.getUint32(i + 4, true);
    crc =
      (at(t, T7 + (one & 0xff)) ^
        at(t, T6 + ((one >>> 8) & 0xff)) ^
        at(t, T5 + ((one >>> 16) & 0xff)) ^
        at(t, T4 + ((one >>> 24) & 0xff)) ^
        at(t, T3 + (two & 0xff)) ^
        at(t, T2 + ((two >>> 8) & 0xff)) ^
        at(t, T1 + ((two >>> 16) & 0xff)) ^
        at(t, (two >>> 24) & 0xff)) >>>
      0;
    i += 8;
  }
  for (; i < len; i++) {
    crc = (at(t, (crc ^ dv.getUint8(i)) & 0xff) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
