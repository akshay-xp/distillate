import { expect, test } from "vitest";

import { normalize } from "../../src/core/bytes.js";

test("normalize encodes strings as UTF-8", () => {
  expect(normalize("hi")).toEqual(new Uint8Array([104, 105]));
  expect(normalize("é")).toEqual(new Uint8Array([0xc3, 0xa9]));
  expect(normalize("")).toEqual(new Uint8Array([]));
});
