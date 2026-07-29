import fc from "fast-check";
import { expect, test } from "vitest";

import {
  hash128,
  hash128Key,
  probeInto,
  probes,
} from "../../src/core/hasher.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test("hash128 matches reference MurmurHash3_x64_128 vectors", () => {
  expect(hash128(new Uint8Array(0), 0)).toEqual({
    h1lo: 0,
    h1hi: 0,
    h2lo: 0,
    h2hi: 0,
  });
  expect(hash128(enc(""), 42)).toEqual({
    h1lo: 0xfa1b8523,
    h1hi: 0xf02aa77d,
    h2lo: 0xda11cbb9,
    h2hi: 0xd1016610,
  });
  expect(hash128(enc("a"), 0)).toEqual({
    h1lo: 0xf6597889,
    h1hi: 0x85555565,
    h2lo: 0x510e895a,
    h2hi: 0xe6b53a48,
  });
  expect(hash128(enc("abc"), 0)).toEqual({
    h1lo: 0x3fad7867,
    h1hi: 0xb4963f3f,
    h2lo: 0x26ca2d52,
    h2hi: 0x3ba27441,
  });
  expect(hash128(enc("Hello, world!"), 0)).toEqual({
    h1lo: 0xd2d665df,
    h1hi: 0xf1512dd1,
    h2lo: 0xa8f3c564,
    h2hi: 0x2c326650,
  });
  expect(
    hash128(enc("The quick brown fox jumps over the lazy dog"), 0),
  ).toEqual({
    h1lo: 0xbc071b6c,
    h1hi: 0xe34bbc7b,
    h2lo: 0xc49a9347,
    h2hi: 0x7a433ca9,
  });
  expect(hash128(enc("abc"), 42)).toEqual({
    h1lo: 0xb3cff7d6,
    h1hi: 0x0d85089f,
    h2lo: 0x42353d30,
    h2hi: 0x7510712b,
  });
});

test("probes returns count indices, all within [0, range)", () => {
  const out = probes("hello", 7, 1000, 0);
  expect(out).toHaveLength(7);
  for (const idx of out) {
    expect(Number.isInteger(idx)).toBe(true);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(1000);
  }
});

test("probes is deterministic and seed-sensitive", () => {
  expect(probes("hello", 7, 1000, 0)).toEqual(probes("hello", 7, 1000, 0));
  expect(probes("hello", 7, 1000, 1)).not.toEqual(probes("hello", 7, 1000, 0));
});

test("probes with range 1 yields all zeros", () => {
  expect(probes("hello", 5, 1, 0)).toEqual(new Uint32Array([0, 0, 0, 0, 0]));
});

test("probes stays in range and finite near 2^32", () => {
  const range = 2 ** 32 - 1;
  const out = probes("x", 16, range, 0);
  for (const idx of out) {
    expect(Number.isInteger(idx)).toBe(true);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(range);
  }
});

test("probes spans the full range across keys", () => {
  let lowSeen = false;
  let highSeen = false;
  for (let n = 0; n < 500; n++) {
    for (const idx of probes(String(n), 4, 1000, 0)) {
      expect(idx).toBeLessThan(1000);
      if (idx < 100) lowSeen = true;
      if (idx > 900) highSeen = true;
    }
  }
  expect(lowSeen).toBe(true);
  expect(highSeen).toBe(true);
});

test("probeInto fills a caller array identically to probes (property)", () => {
  fc.assert(
    fc.property(
      fc.string(),
      fc.integer({ min: 1, max: 16 }),
      fc.integer({ min: 1, max: 1 << 24 }),
      fc.integer({ min: 0, max: 0xffffffff }),
      (key, count, range, seed) => {
        const out = new Uint32Array(count);
        probeInto(key, count, range, seed, out);
        expect(out).toEqual(probes(key, count, range, seed));
      },
    ),
  );
});

const patternBytes = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

test("hash128 matches the reference across all tail lengths and multi-block", () => {
  const REF = [
    {
      len: 0,
      seed: 0,
      h1lo: 0x00000000,
      h1hi: 0x00000000,
      h2lo: 0x00000000,
      h2hi: 0x00000000,
    },
    {
      len: 1,
      seed: 0,
      h1lo: 0xe617f1e7,
      h1hi: 0x932fc7cc,
      h2lo: 0x6c4508dc,
      h2hi: 0x7a434b81,
    },
    {
      len: 2,
      seed: 0,
      h1lo: 0x5471b39d,
      h1hi: 0xcff7e5ae,
      h2lo: 0x77c47536,
      h2hi: 0x8549c3b2,
    },
    {
      len: 3,
      seed: 0,
      h1lo: 0xde81a4b1,
      h1hi: 0x6afac0b8,
      h2lo: 0x816ab243,
      h2hi: 0x0cdcf4fb,
    },
    {
      len: 4,
      seed: 0,
      h1lo: 0xb81f9f72,
      h1hi: 0xd3a4eed1,
      h2lo: 0xd9a420cd,
      h2hi: 0x8f4cf22a,
    },
    {
      len: 5,
      seed: 0,
      h1lo: 0x087f990b,
      h1hi: 0xb0330f40,
      h2lo: 0x9963f50b,
      h2hi: 0xad93f975,
    },
    {
      len: 6,
      seed: 0,
      h1lo: 0x04077a12,
      h1hi: 0x32d1f10b,
      h2lo: 0x3829937e,
      h2hi: 0x4b5791ad,
    },
    {
      len: 7,
      seed: 0,
      h1lo: 0x6662983b,
      h1hi: 0x8340cc68,
      h2lo: 0xaa7ff6f9,
      h2hi: 0xa08f38df,
    },
    {
      len: 8,
      seed: 0,
      h1lo: 0x7f89ced7,
      h1hi: 0xf0b14400,
      h2lo: 0x2d7af9a1,
      h2hi: 0xd0222183,
    },
    {
      len: 9,
      seed: 0,
      h1lo: 0xaec8a0b1,
      h1hi: 0xdbb3088e,
      h2lo: 0x2efe09a9,
      h2hi: 0xcbde2418,
    },
    {
      len: 10,
      seed: 0,
      h1lo: 0xfd4f371e,
      h1hi: 0x7fc82ef8,
      h2lo: 0x596298b0,
      h2hi: 0x7a1ac716,
    },
    {
      len: 11,
      seed: 0,
      h1lo: 0x0920d564,
      h1hi: 0xce105a4d,
      h2lo: 0x727fc1d6,
      h2hi: 0xc5c7129b,
    },
    {
      len: 12,
      seed: 0,
      h1lo: 0xafc3bbb8,
      h1hi: 0x11eea59f,
      h2lo: 0x9b0ddbf8,
      h2hi: 0xde304d58,
    },
    {
      len: 13,
      seed: 0,
      h1lo: 0x790cc4e7,
      h1hi: 0x3c0bc0c7,
      h2lo: 0x12f9b27e,
      h2hi: 0xf34ba40d,
    },
    {
      len: 14,
      seed: 0,
      h1lo: 0xbeeea171,
      h1hi: 0x4af05278,
      h2lo: 0xea75fb09,
      h2hi: 0x27302e3c,
    },
    {
      len: 15,
      seed: 0,
      h1lo: 0xb67f83ff,
      h1hi: 0x2906f047,
      h2lo: 0xe7701fac,
      h2hi: 0x49ca338f,
    },
    {
      len: 16,
      seed: 0,
      h1lo: 0x0c5ef0fb,
      h1hi: 0xda9c6658,
      h2lo: 0xbb6c5ff7,
      h2hi: 0x885aae87,
    },
    {
      len: 17,
      seed: 0,
      h1lo: 0x775e07d1,
      h1hi: 0x78b8ee9a,
      h2lo: 0x1698fce0,
      h2hi: 0xe3679030,
    },
    {
      len: 32,
      seed: 0,
      h1lo: 0x8efe799b,
      h1hi: 0xaf7374eb,
      h2lo: 0x4dcdd6ff,
      h2hi: 0x3a520092,
    },
    {
      len: 33,
      seed: 0,
      h1lo: 0xc3099ba9,
      h1hi: 0x08b88a88,
      h2lo: 0xb5df8af9,
      h2hi: 0x15c06fbd,
    },
    {
      len: 40,
      seed: 0,
      h1lo: 0xe65e7cfc,
      h1hi: 0xbf77aa22,
      h2lo: 0x4c05748b,
      h2hi: 0x15f2951b,
    },
    {
      len: 0,
      seed: 42,
      h1lo: 0xfa1b8523,
      h1hi: 0xf02aa77d,
      h2lo: 0xda11cbb9,
      h2hi: 0xd1016610,
    },
    {
      len: 13,
      seed: 42,
      h1lo: 0x88d07266,
      h1hi: 0x5743a54b,
      h2lo: 0xf0f9941f,
      h2hi: 0x231d088d,
    },
    {
      len: 40,
      seed: 42,
      h1lo: 0x7d6f094d,
      h1hi: 0x1e0a94ce,
      h2lo: 0xa3bf1e3c,
      h2hi: 0x73768e93,
    },
  ] as const;

  for (const { len, seed, h1lo, h1hi, h2lo, h2hi } of REF) {
    expect(hash128(patternBytes(len), seed)).toEqual({
      h1lo,
      h1hi,
      h2lo,
      h2hi,
    });
  }
});

test("hash128 with len ignores bytes past len (reused-buffer safe)", () => {
  const data = enc("hello");
  const padded = new Uint8Array(64).fill(0xff);
  padded.set(data);
  expect(hash128(padded, 0, data.length)).toEqual(hash128(data, 0));
});

test("hash128(b, seed, len) equals hash128(b.subarray(0, len), seed)", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 40 }), fc.nat(40), (b, k) => {
      const len = Math.min(k, b.length);
      expect(hash128(b, 0, len)).toEqual(hash128(b.subarray(0, len), 0));
    }),
  );
});

test("hash128Key equals hash128(normalize(key)) for string and byte keys", () => {
  for (const s of ["", "hi", "héllo", "🎉"]) {
    expect(hash128Key(s, 0)).toEqual(hash128(enc(s), 0));
  }
  expect(hash128Key("abc", 42)).toEqual(hash128(enc("abc"), 42));
  expect(hash128Key(enc("abc"), 0)).toEqual(hash128(enc("abc"), 0));
  expect(hash128Key(enc("abc").buffer as ArrayBuffer, 0)).toEqual(
    hash128(enc("abc"), 0),
  );
});
