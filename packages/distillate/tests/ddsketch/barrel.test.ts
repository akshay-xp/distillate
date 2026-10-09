import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
    "bitwiseMapping",
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

test("the protobuf barrel exports the codec and the decode errors", async () => {
  const protobuf = await import("../../src/ddsketch/protobuf/index.js");
  expect(Object.keys(protobuf).sort()).toEqual([
    "SerializationError",
    "fromProtobuf",
    "toProtobuf",
  ]);
  expect(protobuf.SerializationError).toBe(bloom.SerializationError);
  const s = ddsketch.DDSketch.from([1, 2, 3], 0.01);
  expect(protobuf.fromProtobuf(protobuf.toProtobuf(s)).count).toBe(3);
});

// The codec is its own subpath so a caller who never talks to Datadog never
// bundles it. Walking the static imports from the sketch's entry proves no
// path reaches it.
test("importing distillate/ddsketch does not reach the protobuf codec", () => {
  const src = fileURLToPath(new URL("../../src/", import.meta.url));
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const [, spec] of code.matchAll(/from "(\.[^"]+)"/g)) {
      walk(resolve(dirname(file), spec ?? "").replace(/\.js$/, ".ts"));
    }
  };
  walk(resolve(src, "ddsketch/index.ts"));
  expect([...seen].some((f) => f.includes("/ddsketch/protobuf/"))).toBe(false);
  expect(seen.has(resolve(src, "ddsketch/ddsketch.ts"))).toBe(true);
});
