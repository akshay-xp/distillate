// Portable base64 (RFC 4648) with no dependency on Buffer, atob/btoa, or the
// not-yet-universal native Uint8Array.toBase64.
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const DECODE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) {
  DECODE[ALPHABET.charCodeAt(i)] = i;
}

// charAt (not `[]`) so the 0-63 index reads stay `string`, not `string | undefined`.
const sym = (n: number): string => ALPHABET.charAt(n & 63);

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n =
      ((bytes[i] ?? 0) << 16) |
      ((bytes[i + 1] ?? 0) << 8) |
      (bytes[i + 2] ?? 0);
    out += sym(n >>> 18) + sym(n >>> 12) + sym(n >>> 6) + sym(n);
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += sym(n >>> 18) + sym(n >>> 12) + "==";
  } else if (rem === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += sym(n >>> 18) + sym(n >>> 12) + sym(n >>> 6) + "=";
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61) len--; // strip '=' padding
  const out = new Uint8Array((len * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < len; i++) {
    const v = DECODE[s.charCodeAt(i)] ?? -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return out;
}
