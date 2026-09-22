import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as cuckoo from "../../src/cuckoo/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident.
test("the barrel exports the filter, its sizing, its errors, and the shared errors", () => {
  expect(Object.keys(cuckoo).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "CuckooFilter",
    "CuckooFullError",
    "ParamError",
    "ReservedBitsError",
    "SerializationError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
    "cuckooSizing",
  ]);
});

test("one catch matches a decode or settings failure from any subpath", () => {
  expect(cuckoo.SerializationError).toBe(bloom.SerializationError);
  expect(cuckoo.ParamError).toBe(bloom.ParamError);
});

test("the barrel is wired to the real implementation", () => {
  const f = cuckoo.CuckooFilter.create(10, 0.01);
  f.add("a");
  expect(f.has("a")).toBe(true);
  f.delete("a");
  expect(f.has("a")).toBe(false);
});
