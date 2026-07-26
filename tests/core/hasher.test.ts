import { expect, test } from "vitest";

import { hash128 } from "../../src/core/hasher.js";

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
