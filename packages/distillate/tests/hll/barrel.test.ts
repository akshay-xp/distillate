import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as hll from "../../src/hll/index.js";
import * as root from "../../src/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident, the way a re-export of an internal helper would.
test("the barrel exports the sketch, its sizing, and the shared errors", () => {
  expect(Object.keys(hll).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "HyperLogLog",
    "ParamError",
    "SerializationError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
    "hllSizing",
  ]);
});

test("the error surface matches the other subpaths", () => {
  const errors = (mod: Record<string, unknown>): string[] =>
    Object.keys(mod)
      .filter((name) => name.endsWith("Error"))
      .sort();

  expect(errors(hll)).toEqual(
    errors(bloom).filter((n) => !n.startsWith("Bloom")),
  );
});

test("the barrel is wired to the real implementation", () => {
  expect(hll.HyperLogLog.create(0.01).p).toBe(14);
  expect(hll.hllSizing(0.01).p).toBe(14);

  const sketch = new hll.HyperLogLog({ p: 14 });
  sketch.add("alice");
  expect(sketch.count()).toBe(1);
});

test("the root barrel stays lean", () => {
  expect(Object.keys(root)).toEqual(["VERSION"]);
});
