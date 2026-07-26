import { expect, test } from "vitest";

import { normalize } from "../../src/core/bytes.js";

test("normalize encodes strings as UTF-8", () => {
  expect(normalize("hi")).toEqual(new Uint8Array([104, 105]));
  expect(normalize("é")).toEqual(new Uint8Array([0xc3, 0xa9]));
  expect(normalize("")).toEqual(new Uint8Array([]));
});

test("normalize returns a Uint8Array view's bytes without over-reading", () => {
  const buf = new Uint8Array([9, 1, 2, 3, 9]);
  const view = buf.subarray(1, 4);
  expect(normalize(view)).toEqual(new Uint8Array([1, 2, 3]));
});

test("normalize wraps an ArrayBuffer and matches other input forms", () => {
  const ab = Uint8Array.of(65, 66).buffer;
  expect(normalize(ab)).toEqual(new Uint8Array([65, 66]));

  const fromString = normalize("AB");
  const fromArray = normalize(Uint8Array.of(65, 66));
  const fromBuffer = normalize(ab);
  expect(fromString).toEqual(fromArray);
  expect(fromArray).toEqual(fromBuffer);
});
