import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { cuckooSizing } from "../../src/cuckoo/sizing.js";

test("cuckooSizing(1000, 0.01) pins width, buckets and bits per key", () => {
  // f = ceil(log2(8 / 0.01)) = 10; buckets = ceil(1000 / 3.8) + ceil(sqrt(1000)).
  expect(cuckooSizing(1000, 0.01)).toEqual({
    f: 10,
    buckets: 296,
    bitsPerKey: 11.84,
  });
});

test("cuckooSizing floors the fingerprint at 4 bits and reaches 32", () => {
  expect(cuckooSizing(1, 0.5)).toMatchObject({ f: 4, buckets: 2 });
  expect(cuckooSizing(1, 2e-9).f).toBe(32);
});

test("cuckooSizing refuses a target that needs more than 32 bits", () => {
  expect(() => cuckooSizing(1, 1e-9)).toThrow(ParamError);
  expect(() => cuckooSizing(1, 1e-9)).toThrow(/32/);
  for (const epsilon of [0, 1]) {
    expect(() => cuckooSizing(1, epsilon)).toThrow(ParamError);
  }
});
