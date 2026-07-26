import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test("crc32 matches canonical IEEE 802.3 vectors", () => {
  expect(crc32(new Uint8Array(0))).toBe(0x00000000);
  expect(crc32(enc("123456789"))).toBe(0xcbf43926);
  expect(crc32(enc("a"))).toBe(0xe8b7be43);
  expect(crc32(enc("abc"))).toBe(0x352441c2);
});
