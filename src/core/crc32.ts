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
      const p = t[(k - 1) * 256 + n] ?? 0;
      t[k * 256 + n] = ((t[p & 0xff] ?? 0) ^ (p >>> 8)) >>> 0;
    }
  }
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = (tables ??= buildTables());
  const len = bytes.length;
  let crc = 0xffffffff;
  let i = 0;
  const last = len - 8;
  while (i <= last) {
    const one =
      (((bytes[i] ?? 0) |
        ((bytes[i + 1] ?? 0) << 8) |
        ((bytes[i + 2] ?? 0) << 16) |
        ((bytes[i + 3] ?? 0) << 24)) ^
        crc) >>>
      0;
    const two =
      ((bytes[i + 4] ?? 0) |
        ((bytes[i + 5] ?? 0) << 8) |
        ((bytes[i + 6] ?? 0) << 16) |
        ((bytes[i + 7] ?? 0) << 24)) >>>
      0;
    crc =
      ((t[T7 + (one & 0xff)] ?? 0) ^
        (t[T6 + ((one >>> 8) & 0xff)] ?? 0) ^
        (t[T5 + ((one >>> 16) & 0xff)] ?? 0) ^
        (t[T4 + ((one >>> 24) & 0xff)] ?? 0) ^
        (t[T3 + (two & 0xff)] ?? 0) ^
        (t[T2 + ((two >>> 8) & 0xff)] ?? 0) ^
        (t[T1 + ((two >>> 16) & 0xff)] ?? 0) ^
        (t[(two >>> 24) & 0xff] ?? 0)) >>>
      0;
    i += 8;
  }
  for (; i < len; i++) {
    crc = ((t[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
