import { expect, test } from "vitest";

import {
  bundleSize,
  ddSketchBundles,
  minHashBundles,
  ribltBundles,
} from "../src/bundle.js";

test("bundleSize is the gzipped size of a minified bundle", async () => {
  const size = await bundleSize("export const answer = 42;");
  expect(Number.isInteger(size)).toBe(true);
  expect(size).toBeGreaterThan(0);
});

test("each library's DDSketch bundle is measured alone and with protobuf", async () => {
  const rows = await ddSketchBundles();
  expect(rows.map((r) => r.name)).toEqual([
    "distillate/ddsketch",
    "@datadog/sketches-js",
  ]);
  const [ours, theirs] = rows;
  // Ours keeps the codec on its own subpath, so it costs only when imported;
  // sketches-js bundles protobufjs whether or not it serializes.
  expect(ours?.withProtobuf).toBeGreaterThan(ours?.sketch ?? Infinity);
  expect(theirs?.withProtobuf).toBeGreaterThanOrEqual(
    theirs?.sketch ?? Infinity,
  );
});

test("each library's MinHash bundle is measured alone and with its LSH index", async () => {
  const rows = await minHashBundles();
  expect(rows.map((r) => r.name)).toEqual([
    "distillate/minhash",
    "bloom-filters",
    "minhash",
  ]);
  for (const r of rows) expect(r.sketch, r.name).toBeGreaterThan(0);
  const [ours, incumbent, pkg] = rows;
  expect(ours?.withLsh).toBeGreaterThan(0);
  // bloom-filters has no LSH index to bundle.
  expect(incumbent?.withLsh).toBeNull();
  expect(pkg?.withLsh).toBeGreaterThan(0);
});

test("each reconciler's bundle is measured", async () => {
  const rows = await ribltBundles();
  expect(rows.map((r) => r.name)).toEqual([
    "distillate/riblt",
    "ribbit-riblt",
    "bloom-filters",
  ]);
  for (const r of rows) expect(r.bytes, r.name).toBeGreaterThan(0);
});
