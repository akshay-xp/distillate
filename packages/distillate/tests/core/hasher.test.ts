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
    w0: 0,
    w1: 0,
    w2: 0,
    w3: 0,
  });
  expect(hash128(enc(""), 42)).toEqual({
    w0: 0xaf6d2cb6,
    w1: 0x95c80cba,
    w2: 0x95c80cba,
    w3: 0x95c80cba,
  });
  expect(hash128(enc("a"), 0)).toEqual({
    w0: 0xa794933c,
    w1: 0x5556b01b,
    w2: 0x5556b01b,
    w3: 0x5556b01b,
  });
  expect(hash128(enc("abc"), 0)).toEqual({
    w0: 0x75cdc6d1,
    w1: 0xa2b006a5,
    w2: 0xa2b006a5,
    w3: 0xa2b006a5,
  });
  expect(hash128(enc("Hello, world!"), 0)).toEqual({
    w0: 0x26acdba7,
    w1: 0xf0638dfc,
    w2: 0x402b4263,
    w3: 0x0afdd4c3,
  });
  expect(
    hash128(enc("The quick brown fox jumps over the lazy dog"), 0),
  ).toEqual({
    w0: 0x2f1583c3,
    w1: 0xecee2c67,
    w2: 0x5d7bf66c,
    w3: 0xe5e91d2c,
  });
  expect(hash128(enc("abc"), 42)).toEqual({
    w0: 0x5bcf0fbe,
    w1: 0x8741bbe9,
    w2: 0x8741bbe9,
    w3: 0x8741bbe9,
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
      w0: 0x00000000,
      w1: 0x00000000,
      w2: 0x00000000,
      w3: 0x00000000,
    },
    {
      len: 1,
      seed: 0,
      w0: 0x1a2a893c,
      w1: 0x825db56b,
      w2: 0x825db56b,
      w3: 0x825db56b,
    },
    {
      len: 2,
      seed: 0,
      w0: 0xe25b086a,
      w1: 0x946637e0,
      w2: 0x946637e0,
      w3: 0x946637e0,
    },
    {
      len: 3,
      seed: 0,
      w0: 0xef5dd547,
      w1: 0x814fe1d3,
      w2: 0x814fe1d3,
      w3: 0x814fe1d3,
    },
    {
      len: 4,
      seed: 0,
      w0: 0xd021ef70,
      w1: 0xbffa0a8e,
      w2: 0xbffa0a8e,
      w3: 0xbffa0a8e,
    },
    {
      len: 5,
      seed: 0,
      w0: 0xa1bdd9f5,
      w1: 0xfcb58997,
      w2: 0x253eef03,
      w3: 0x253eef03,
    },
    {
      len: 6,
      seed: 0,
      w0: 0x1104c619,
      w1: 0x533a1fa2,
      w2: 0xcf86f34e,
      w3: 0xcf86f34e,
    },
    {
      len: 7,
      seed: 0,
      w0: 0xfefb3e3f,
      w1: 0x0cf7684e,
      w2: 0xf2c048de,
      w3: 0xf2c048de,
    },
    {
      len: 8,
      seed: 0,
      w0: 0xfc0141d5,
      w1: 0xf89a9067,
      w2: 0x40e16338,
      w3: 0x40e16338,
    },
    {
      len: 9,
      seed: 0,
      w0: 0x37dd5f38,
      w1: 0x0f9dc92c,
      w2: 0xdd382ad9,
      w3: 0xc0f0e315,
    },
    {
      len: 10,
      seed: 0,
      w0: 0xbe719708,
      w1: 0x8b31ff12,
      w2: 0x7f068c22,
      w3: 0x351e0368,
    },
    {
      len: 11,
      seed: 0,
      w0: 0xb7d8ddb0,
      w1: 0x02ff2c68,
      w2: 0x5ceb057c,
      w3: 0x2864d73b,
    },
    {
      len: 12,
      seed: 0,
      w0: 0x6bbe8b8b,
      w1: 0x92dde2a2,
      w2: 0x427c9e8a,
      w3: 0x04feaac2,
    },
    {
      len: 13,
      seed: 0,
      w0: 0xcbedda29,
      w1: 0x107c882c,
      w2: 0x3bab087f,
      w3: 0x1445e0c3,
    },
    {
      len: 14,
      seed: 0,
      w0: 0x3bbe5d42,
      w1: 0x263b2967,
      w2: 0x08a8894d,
      w3: 0xf5d7806d,
    },
    {
      len: 15,
      seed: 0,
      w0: 0xe834163d,
      w1: 0x88c1111c,
      w2: 0x03559fa9,
      w3: 0x7162791c,
    },
    {
      len: 16,
      seed: 0,
      w0: 0xaa3a2073,
      w1: 0xa8c41845,
      w2: 0xadf04182,
      w3: 0xb35623e7,
    },
    {
      len: 17,
      seed: 0,
      w0: 0xc5078dc0,
      w1: 0xfbe3511f,
      w2: 0x9ede0bb0,
      w3: 0xaee0538b,
    },
    {
      len: 32,
      seed: 0,
      w0: 0xce5ff737,
      w1: 0xe3dfb338,
      w2: 0x5d53b314,
      w3: 0xabafe93f,
    },
    {
      len: 33,
      seed: 0,
      w0: 0xf2ce5217,
      w1: 0x28758d8f,
      w2: 0x8b5892a5,
      w3: 0x887e3f9d,
    },
    {
      len: 40,
      seed: 0,
      w0: 0xeb975766,
      w1: 0x9168c682,
      w2: 0x544b34cb,
      w3: 0xd94ef36b,
    },
    {
      len: 0,
      seed: 42,
      w0: 0xaf6d2cb6,
      w1: 0x95c80cba,
      w2: 0x95c80cba,
      w3: 0x95c80cba,
    },
    {
      len: 13,
      seed: 42,
      w0: 0x73dc88d4,
      w1: 0x039193e4,
      w2: 0x2a73334e,
      w3: 0x5e8dc48a,
    },
    {
      len: 40,
      seed: 42,
      w0: 0x8e10a1ff,
      w1: 0x62464e75,
      w2: 0xb808e2f5,
      w3: 0xc579ee1e,
    },
  ] as const;

  for (const { len, seed, w0, w1, w2, w3 } of REF) {
    expect(hash128(patternBytes(len), seed)).toEqual({
      w0,
      w1,
      w2,
      w3,
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
    const out: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };
    hash128KeyInto(key, seed, out);
    expect(out).toEqual(hash128Key(key, seed));
  }
});

test("hash128/hash128Key return independent objects (no aliasing)", () => {
  const a = hash128Key("abc", 0);
  hash128Key("xyz", 0);
  expect(a).toEqual(hash128(enc("abc"), 0));
});
