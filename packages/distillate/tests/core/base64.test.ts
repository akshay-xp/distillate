import fc from "fast-check";
import { expect, test } from "vitest";

import { fromBase64, toBase64 } from "../../src/core/base64.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const VECTORS: [string, string][] = [
  ["", ""],
  ["f", "Zg=="],
  ["fo", "Zm8="],
  ["foo", "Zm9v"],
  ["foob", "Zm9vYg=="],
  ["fooba", "Zm9vYmE="],
  ["foobar", "Zm9vYmFy"],
];

test("toBase64 matches RFC 4648 vectors with correct padding", () => {
  for (const [input, expected] of VECTORS) {
    expect(toBase64(enc(input))).toBe(expected);
  }
});

test("fromBase64 inverts the RFC 4648 vectors", () => {
  for (const [input, encoded] of VECTORS) {
    expect(fromBase64(encoded)).toEqual(enc(input));
  }
});

test("fromBase64 rejects invalid characters and lengths", () => {
  expect(() => fromBase64("!!!!!!!!")).toThrow(RangeError);
  expect(() => fromBase64("Z\ng")).toThrow(RangeError);
  expect(() => fromBase64("A")).toThrow(RangeError);
});

test("fromBase64(toBase64(b)) round-trips arbitrary bytes", () => {
  fc.assert(
    fc.property(fc.uint8Array(), (b) => {
      expect(fromBase64(toBase64(b))).toEqual(b);
    }),
  );
});
