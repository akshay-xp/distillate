import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as countmin from "../../src/countmin/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident.
test("the barrel exports the sketch, its sizing, its errors, and the shared errors", () => {
  expect(Object.keys(countmin).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "CountMinOverflowError",
    "CountMinParamMismatchError",
    "CountMinSketch",
    "ParamError",
    "ReservedBitsError",
    "SerializationError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
    "countMinSizing",
  ]);
});

test("one catch matches a decode or settings failure from any subpath", () => {
  expect(countmin.SerializationError).toBe(bloom.SerializationError);
  expect(countmin.ParamError).toBe(bloom.ParamError);
});

test("the barrel is wired to the real implementation", () => {
  const s = countmin.CountMinSketch.create(0.01, 0.01);
  s.add("a", 3);

  expect(s.count("a")).toBe(3);
  expect(s.total).toBe(3);
  expect(countmin.countMinSizing(0.001, 0.001)).toEqual({
    width: 2719,
    depth: 7,
  });
});
