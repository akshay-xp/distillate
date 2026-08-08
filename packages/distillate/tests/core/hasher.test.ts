import fc from "fast-check";
import { expect, test } from "vitest";

import { type BytesLike } from "../../src/core/bytes.js";
import {
  hash128,
  type Hash128,
  hash128Key,
  hash128KeyInto,
  probeInto,
  probes,
} from "../../src/core/hasher.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test("hash128 matches reference murmur3_x86_128 vectors", () => {
  expect(hash128(new Uint8Array(0), 0)).toEqual({
    h1lo: 0,
    h1hi: 0,
    h2lo: 0,
    h2hi: 0,
  });
  expect(hash128(enc(""), 42)).toEqual({
    h1lo: 0xaf6d2cb6,
    h1hi: 0x95c80cba,
    h2lo: 0x95c80cba,
    h2hi: 0x95c80cba,
  });
  expect(hash128(enc("a"), 0)).toEqual({
    h1lo: 0xa794933c,
    h1hi: 0x5556b01b,
    h2lo: 0x5556b01b,
    h2hi: 0x5556b01b,
  });
  expect(hash128(enc("abc"), 0)).toEqual({
    h1lo: 0x75cdc6d1,
    h1hi: 0xa2b006a5,
    h2lo: 0xa2b006a5,
    h2hi: 0xa2b006a5,
  });
  expect(hash128(enc("Hello, world!"), 0)).toEqual({
    h1lo: 0x26acdba7,
    h1hi: 0xf0638dfc,
    h2lo: 0x402b4263,
    h2hi: 0x0afdd4c3,
  });
  expect(
    hash128(enc("The quick brown fox jumps over the lazy dog"), 0),
  ).toEqual({
    h1lo: 0x2f1583c3,
    h1hi: 0xecee2c67,
    h2lo: 0x5d7bf66c,
    h2hi: 0xe5e91d2c,
  });
  expect(hash128(enc("abc"), 42)).toEqual({
    h1lo: 0x5bcf0fbe,
    h1hi: 0x8741bbe9,
    h2lo: 0x8741bbe9,
    h2hi: 0x8741bbe9,
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
      h1lo: 0x1a2a893c,
      h1hi: 0x825db56b,
      h2lo: 0x825db56b,
      h2hi: 0x825db56b,
    },
    {
      len: 2,
      seed: 0,
      h1lo: 0xe25b086a,
      h1hi: 0x946637e0,
      h2lo: 0x946637e0,
      h2hi: 0x946637e0,
    },
    {
      len: 3,
      seed: 0,
      h1lo: 0xef5dd547,
      h1hi: 0x814fe1d3,
      h2lo: 0x814fe1d3,
      h2hi: 0x814fe1d3,
    },
    {
      len: 4,
      seed: 0,
      h1lo: 0xd021ef70,
      h1hi: 0xbffa0a8e,
      h2lo: 0xbffa0a8e,
      h2hi: 0xbffa0a8e,
    },
    {
      len: 5,
      seed: 0,
      h1lo: 0xa1bdd9f5,
      h1hi: 0xfcb58997,
      h2lo: 0x253eef03,
      h2hi: 0x253eef03,
    },
    {
      len: 6,
      seed: 0,
      h1lo: 0x1104c619,
      h1hi: 0x533a1fa2,
      h2lo: 0xcf86f34e,
      h2hi: 0xcf86f34e,
    },
    {
      len: 7,
      seed: 0,
      h1lo: 0xfefb3e3f,
      h1hi: 0x0cf7684e,
      h2lo: 0xf2c048de,
      h2hi: 0xf2c048de,
    },
    {
      len: 8,
      seed: 0,
      h1lo: 0xfc0141d5,
      h1hi: 0xf89a9067,
      h2lo: 0x40e16338,
      h2hi: 0x40e16338,
    },
    {
      len: 9,
      seed: 0,
      h1lo: 0x37dd5f38,
      h1hi: 0x0f9dc92c,
      h2lo: 0xdd382ad9,
      h2hi: 0xc0f0e315,
    },
    {
      len: 10,
      seed: 0,
      h1lo: 0xbe719708,
      h1hi: 0x8b31ff12,
      h2lo: 0x7f068c22,
      h2hi: 0x351e0368,
    },
    {
      len: 11,
      seed: 0,
      h1lo: 0xb7d8ddb0,
      h1hi: 0x02ff2c68,
      h2lo: 0x5ceb057c,
      h2hi: 0x2864d73b,
    },
    {
      len: 12,
      seed: 0,
      h1lo: 0x6bbe8b8b,
      h1hi: 0x92dde2a2,
      h2lo: 0x427c9e8a,
      h2hi: 0x04feaac2,
    },
    {
      len: 13,
      seed: 0,
      h1lo: 0xcbedda29,
      h1hi: 0x107c882c,
      h2lo: 0x3bab087f,
      h2hi: 0x1445e0c3,
    },
    {
      len: 14,
      seed: 0,
      h1lo: 0x3bbe5d42,
      h1hi: 0x263b2967,
      h2lo: 0x08a8894d,
      h2hi: 0xf5d7806d,
    },
    {
      len: 15,
      seed: 0,
      h1lo: 0xe834163d,
      h1hi: 0x88c1111c,
      h2lo: 0x03559fa9,
      h2hi: 0x7162791c,
    },
    {
      len: 16,
      seed: 0,
      h1lo: 0xaa3a2073,
      h1hi: 0xa8c41845,
      h2lo: 0xadf04182,
      h2hi: 0xb35623e7,
    },
    {
      len: 17,
      seed: 0,
      h1lo: 0xc5078dc0,
      h1hi: 0xfbe3511f,
      h2lo: 0x9ede0bb0,
      h2hi: 0xaee0538b,
    },
    {
      len: 32,
      seed: 0,
      h1lo: 0xce5ff737,
      h1hi: 0xe3dfb338,
      h2lo: 0x5d53b314,
      h2hi: 0xabafe93f,
    },
    {
      len: 33,
      seed: 0,
      h1lo: 0xf2ce5217,
      h1hi: 0x28758d8f,
      h2lo: 0x8b5892a5,
      h2hi: 0x887e3f9d,
    },
    {
      len: 40,
      seed: 0,
      h1lo: 0xeb975766,
      h1hi: 0x9168c682,
      h2lo: 0x544b34cb,
      h2hi: 0xd94ef36b,
    },
    {
      len: 0,
      seed: 42,
      h1lo: 0xaf6d2cb6,
      h1hi: 0x95c80cba,
      h2lo: 0x95c80cba,
      h2hi: 0x95c80cba,
    },
    {
      len: 13,
      seed: 42,
      h1lo: 0x73dc88d4,
      h1hi: 0x039193e4,
      h2lo: 0x2a73334e,
      h2hi: 0x5e8dc48a,
    },
    {
      len: 40,
      seed: 42,
      h1lo: 0x8e10a1ff,
      h1hi: 0x62464e75,
      h2lo: 0xb808e2f5,
      h2hi: 0xc579ee1e,
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

test("hash128Key grows its buffer for keys longer than the initial size", () => {
  const long = "a".repeat(300);
  expect(hash128Key(long, 0)).toEqual(hash128(enc(long), 0));
});

test("hash128KeyInto fills out identically to hash128Key", () => {
  const cases: [BytesLike, number][] = [
    ["", 0],
    ["abc", 0],
    ["héllo", 0],
    ["🎉", 0],
    [enc("abc"), 0],
    ["abc", 42],
  ];
  for (const [key, seed] of cases) {
    const out: Hash128 = { h1lo: 0, h1hi: 0, h2lo: 0, h2hi: 0 };
    hash128KeyInto(key, seed, out);
    expect(out).toEqual(hash128Key(key, seed));
  }
});

test("hash128/hash128Key return independent objects (no aliasing)", () => {
  const a = hash128Key("abc", 0);
  hash128Key("xyz", 0);
  expect(a).toEqual(hash128(enc("abc"), 0));
});
