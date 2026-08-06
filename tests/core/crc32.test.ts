import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test("crc32 matches canonical IEEE 802.3 vectors", () => {
  expect(crc32(new Uint8Array(0))).toBe(0x00000000);
  expect(crc32(enc("123456789"))).toBe(0xcbf43926);
  expect(crc32(enc("a"))).toBe(0xe8b7be43);
  expect(crc32(enc("abc"))).toBe(0x352441c2);
});

const pattern = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

test("crc32 matches multi-block vectors (0/4/7-byte remainders)", () => {
  expect(crc32(pattern(64))).toBe(0xffbae609);
  expect(crc32(pattern(100))).toBe(0x7d11b4c9);
  expect(crc32(pattern(255))).toBe(0x6626d95d);
});
