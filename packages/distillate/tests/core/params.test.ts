import { expect, test } from "vitest";

import { assertUint16, ParamError } from "../../src/core/params.js";

test("assertUint16 accepts 0..65535 and rejects everything else", () => {
  expect(() => {
    assertUint16(0, "v");
  }).not.toThrow();
  expect(() => {
    assertUint16(65535, "v");
  }).not.toThrow();
  for (const bad of [-1, 1.5, 65536, NaN]) {
    expect(() => {
      assertUint16(bad, "v");
    }).toThrow(ParamError);
  }
});
