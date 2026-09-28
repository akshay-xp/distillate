import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as topk from "../../src/topk/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident.
test("the barrel exports the sketch, its sizing, its errors, and the shared errors", () => {
  expect(Object.keys(topk).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "ParamError",
    "ReservedBitsError",
    "SerializationError",
    "TopK",
    "TopKOverflowError",
    "TopKParamMismatchError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
    "topKSizing",
  ]);
});

test("one catch matches a decode or settings failure from any subpath", () => {
  expect(topk.SerializationError).toBe(bloom.SerializationError);
  expect(topk.ParamError).toBe(bloom.ParamError);
});

test("the barrel is wired to the real implementation", () => {
  const s = topk.TopK.create(0.01);
  s.add("a", 3);

  expect(s.capacity).toBe(512);
  expect(s.count("a")).toBe(3);
  expect(s.total).toBe(3);
  expect(topk.topKSizing(0.01)).toEqual({ capacity: 512 });
});
