import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as riblt from "../../src/riblt/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. The module-internal hand-off (nextSymbol, pushSymbol) must not be
// among them.
test("the barrel exports the encoder, the decoder and the shared errors", () => {
  expect(Object.keys(riblt).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "ParamError",
    "ReservedBitsError",
    "RibltDecoder",
    "RibltEncoder",
    "RibltParamMismatchError",
    "SerializationError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
  ]);
});

test("the error surface matches the other subpaths", () => {
  const errors = (mod: Record<string, unknown>): string[] =>
    Object.keys(mod)
      .filter((name) => name.endsWith("Error"))
      .sort();

  expect(errors(riblt)).toEqual(
    [
      ...errors(bloom).filter((n) => !n.startsWith("Bloom")),
      "RibltParamMismatchError",
    ].sort(),
  );
});

test("one catch matches a decode or settings failure from any subpath", () => {
  expect(riblt.SerializationError).toBe(bloom.SerializationError);
  expect(riblt.ParamError).toBe(bloom.ParamError);
});
