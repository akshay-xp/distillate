import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as ddsketch from "../../src/ddsketch/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident; mappingWithGamma in particular stays internal.
test("the barrel exports the sketch, its factories, its error, and the shared errors", () => {
  expect(Object.keys(ddsketch).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "DDSketch",
    "DDSketchParamMismatchError",
    "ParamError",
    "ReservedBitsError",
    "SerializationError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
    "collapsingHighestStore",
    "collapsingLowestStore",
    "cubicMapping",
    "denseStore",
    "linearMapping",
    "logMapping",
    "quadraticMapping",
    "sparseStore",
  ]);
});

test("one catch matches a decode or settings failure from any subpath", () => {
  expect(ddsketch.SerializationError).toBe(bloom.SerializationError);
  expect(ddsketch.ParamError).toBe(bloom.ParamError);
});

test("the barrel is wired to the real implementation", () => {
  const s = ddsketch.DDSketch.from([1, 2, 3], 0.01, {
    mapping: ddsketch.cubicMapping,
    store: ddsketch.sparseStore(),
  });

  expect(s.count).toBe(3);
  expect(s.quantile(1)).toBe(3);
  expect(ddsketch.DDSketch.fromBytes(s.toBytes()).equals(s)).toBe(true);
});
