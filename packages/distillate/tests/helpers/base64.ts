const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decodes a base64 string to bytes without relying on `Buffer` or `atob`. */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const out = new Uint8Array((clean.length * 6) >>> 3);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    acc = (acc << 6) | CHARS.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return out;
}
