import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as theta from "../../src/theta/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident.
test("the barrel exports the sketch, its sizing, and the shared errors", () => {
  expect(Object.keys(theta).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "ParamError",
    "ReservedBitsError",
    "SerializationError",
    "ThetaSketch",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
    "thetaSizing",
  ]);
});

test("the error surface matches the other subpaths", () => {
  const errors = (mod: Record<string, unknown>): string[] =>
    Object.keys(mod)
      .filter((name) => name.endsWith("Error"))
      .sort();

  expect(errors(theta)).toEqual(
    errors(bloom).filter((n) => !n.startsWith("Bloom")),
  );
});

test("one catch matches a decode or settings failure from any subpath", () => {
  expect(theta.SerializationError).toBe(bloom.SerializationError);
  expect(theta.ParamError).toBe(bloom.ParamError);
});

test("the barrel is wired to the real implementation", () => {
  expect(theta.thetaSizing(1 / 64).k).toBe(4096);
  expect(theta.ThetaSketch.from(["a", "b"], 0.05).count()).toBe(2);
});
