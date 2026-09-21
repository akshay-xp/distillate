import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as scalable from "../../src/scalable/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident.
test("the barrel exports the filter, its errors, and the shared errors", () => {
  expect(Object.keys(scalable).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "ParamError",
    "ReservedBitsError",
    "ScalableBloomFilter",
    "ScalableParamMismatchError",
    "SerializationError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
  ]);
});

test("one catch matches a decode failure from any subpath", () => {
  expect(scalable.SerializationError).toBe(bloom.SerializationError);
});

test("the barrel is wired to the real implementation", () => {
  const f = scalable.ScalableBloomFilter.create(10, 0.01);
  f.add("a");
  expect(f.has("a")).toBe(true);
});
