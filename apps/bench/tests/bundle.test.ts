import { expect, test } from "vitest";

import { bundleSize, ddSketchBundles } from "../src/bundle.js";

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
