export type BytesLike = string | Uint8Array | ArrayBuffer;

const encoder = new TextEncoder();

export function normalize(input: BytesLike): Uint8Array {
  if (typeof input === "string") return encoder.encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

// V8 keeps a concatenation of 13+ chars as a rope, where charCodeAt costs about
// twice as much, and on the CPUs measured the copy below stops beating the
// native encodeInto call between 12 and 13 chars.
const ASCII_FAST_MAX = 12;

let keyBuf = new Uint8Array(256);

/**
 * The bytes {@link encodeKey} last wrote: valid up to {@link encodedLength},
 * and only until the next call, since the buffer is reused.
 */
export let encodedBytes: Uint8Array = keyBuf;
export let encodedLength = 0;

/**
 * Encode a key to UTF-8 with no per-call allocation. Strings go into a reused
 * buffer, grown on demand; bytes are used as they are. A short ASCII string is
 * copied directly: its UTF-8 bytes are its char codes, and the first char above
 * 0x7F hands the whole string to `encodeInto` instead.
 */
export function encodeKey(key: BytesLike): void {
  if (typeof key === "string") {
    const n = key.length;
    if (keyBuf.length < n * 3) keyBuf = new Uint8Array(n * 3);
    encodedBytes = keyBuf;
    if (n <= ASCII_FAST_MAX) {
      let i = 0;
      for (; i < n; i++) {
        const c = key.charCodeAt(i);
        if (c > 0x7f) break;
        keyBuf[i] = c;
      }
      if (i === n) {
        encodedLength = n;
        return;
      }
    }
    encodedLength = encoder.encodeInto(key, keyBuf).written;
    return;
  }
  encodedBytes = normalize(key);
  encodedLength = encodedBytes.length;
}
