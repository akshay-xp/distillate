import { expect, test } from "vitest";

import { halfSipHash13 } from "../../src/topk/halfsip.js";

// test_vectors_hsiphash from Linux lib/tests/siphash_kunit.c, the
// HalfSipHash-1-3 build: vector n hashes the bytes 0..n-1 under the key
// 00 01 .. 07.
const VECTORS = [
  0x5814c896, 0xe7e864ca, 0xbc4b0e30, 0x01539939, 0x7e059ea6, 0x88e3d89b,
  0xa0080b65, 0x9d38d9d6, 0x577999b1, 0xc839caed, 0xe4fa32cf, 0x959246ee,
  0x6b28096c, 0x66dd9cd6, 0x16658a7c, 0xd0257b04, 0x8b31d501, 0x2b1cd04b,
  0x06712339, 0x522aca67, 0x911bb605, 0x90a65f0e, 0xf826ef7b, 0x62512deb,
  0x57150ad7, 0x5d473507, 0x1ec47442, 0xab64afd3, 0x0a4100d0, 0x6d2ce652,
  0x2331b6a3, 0x08d8791a, 0xbc6dda8d, 0xe0f6c934, 0xb0652033, 0x9b9851cc,
  0x7c46fb7f, 0x732ba8cb, 0xf142997a, 0xfcc9aa1b, 0x05327eb2, 0xe110131c,
  0xf9e5e7c0, 0xa7d708a6, 0x11795ab1, 0x65671619, 0x9f5fff91, 0xd89c5267,
  0x007783eb, 0x95766243, 0xab639262, 0x9c7e1390, 0xc368dda6, 0x38ddc455,
  0xfa13d379, 0x979ea4e8, 0x53ecd77e, 0x2ee80657, 0x33dbb66a, 0xae3f0577,
  0x88b4c4cc, 0x3e7f480b, 0x74c1ebf8, 0x87178304,
];

const input = Uint8Array.from({ length: 64 }, (_, i) => i);

test.each(VECTORS.map((want, n) => [n, want]))(
  "matches the reference vector for %i bytes",
  (n, want) => {
    expect(halfSipHash13(input.subarray(0, n), 0x03020100, 0x07060504)).toBe(
      want,
    );
  },
);
