import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as minhash from "../../src/minhash/index.js";
import * as root from "../../src/index.js";

// Type-only exports erase, so these are the names a consumer can reach at
// runtime. Pinning the whole set keeps the subpath from acquiring surface by
// accident.
test("the barrel exports the sketch, the index, their sizing, and the shared errors", () => {
  expect(Object.keys(minhash).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "MinHash",
    "MinHashLSH",
    "ParamError",
    "ReservedBitsError",
    "SerializationError",
    "TruncatedError",
    "UnknownHashVariantError",
    "UnknownVersionError",
    "lshSizing",
    "minHashSizing",
  ]);
});

test("the error surface matches the other subpaths", () => {
  const errors = (mod: Record<string, unknown>): string[] =>
    Object.keys(mod)
      .filter((name) => name.endsWith("Error"))
      .sort();

  expect(errors(minhash)).toEqual(
    errors(bloom).filter((n) => !n.startsWith("Bloom")),
  );
});

test("one catch matches a decode or settings failure from any subpath", () => {
  expect(minhash.SerializationError).toBe(bloom.SerializationError);
  expect(minhash.ParamError).toBe(bloom.ParamError);
});

test("the barrel is wired to the real implementation", () => {
  expect(minhash.minHashSizing(0.05).k).toBe(100);
  const sketch = minhash.MinHash.create(0.05);
  sketch.add("alice");
  expect(sketch.jaccard(minhash.MinHash.from(["alice"], 0.05))).toBe(1);

  expect(minhash.lshSizing(0.5, 128).bands).toBe(25);
  const lsh = new minhash.MinHashLSH<string>({ threshold: 0.5, k: 100 });
  lsh.insert("alice", sketch);
  expect(lsh.query(minhash.MinHash.from(["alice"], 0.05))).toEqual(["alice"]);
});

test("the root barrel stays lean", () => {
  expect(Object.keys(root)).toEqual(["VERSION"]);
});
