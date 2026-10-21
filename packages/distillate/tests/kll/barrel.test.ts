import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as kll from "../../src/kll/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident.
test("the barrel exports the sketch, its sizing, and the shared errors", () => {
  expect(Object.keys(kll).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "KllSketch",
    "ParamError",
    "ReservedBitsError",
    "SerializationError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
    "kllSizing",
  ]);
});

test("the error surface matches the other subpaths", () => {
  const errors = (mod: Record<string, unknown>): string[] =>
    Object.keys(mod)
      .filter((name) => name.endsWith("Error"))
      .sort();

  expect(errors(kll)).toEqual(
    errors(bloom).filter((n) => !n.startsWith("Bloom")),
  );
});

test("one catch matches a decode or settings failure from any subpath", () => {
  expect(kll.SerializationError).toBe(bloom.SerializationError);
  expect(kll.ParamError).toBe(bloom.ParamError);
});

test("the barrel is wired to the real implementation", () => {
  expect(kll.kllSizing(0.0133).k).toBe(200);
  const sketch = new kll.KllSketch();
  for (let v = 1; v <= 5; v++) sketch.add(v);
  expect(sketch.quantile(0.5)).toBe(3);
});
