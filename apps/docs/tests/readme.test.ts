import { fileURLToPath } from "node:url";

import { fuseBitsPerKey } from "distillate/fuse";
import { HyperLogLog } from "distillate/hll";
import { expect, test } from "vitest";

import { extractSamples } from "../src/samples.js";

const README = fileURLToPath(
  new URL("../../../packages/distillate/README.md", import.meta.url),
);

/** The number a sample claims for `expr`, from its trailing `// N` comment. */
function claimed(code: string, expr: string): number {
  const pattern = new RegExp(`\\.${expr};\\s*//\\s*(\\d+)`);
  return Number(pattern.exec(code)?.[1]);
}

function fuseSample(): string {
  const sample = extractSamples(README).find((s) =>
    s.code.includes("BinaryFuse8.from"),
  );
  if (!sample) throw new Error("README has no BinaryFuse8 sample");
  return sample.code;
}

// The sample's own `size` comment supplies n, so this checks the README against
// itself and the library rather than against a hardcoded pair. Change the
// sample to a different key count and it still has to tell the truth.
function hllSample(): string {
  const sample = extractSamples(README).find((s) =>
    s.code.includes("HyperLogLog"),
  );
  if (!sample) throw new Error("README has no HyperLogLog sample");
  return sample.code;
}

/** The keys a sample passes to `add`, in order, with duplicates kept. */
function addedKeys(code: string): string[] {
  return [...code.matchAll(/\.add\("([^"]+)"\)/g)].map((m) => m[1]);
}

// Checked against the sample's own keys, not against a count supplied by the
// same comment being verified. The sample adds "alice" twice on purpose, so
// this also pins the claim the duplicate is there to make.
test("the README HyperLogLog sample quotes a count the library reproduces", () => {
  const code = hllSample();
  const keys = addedKeys(code);

  expect(keys.length).toBeGreaterThan(new Set(keys).size);

  const sketch = HyperLogLog.create(0.01);
  for (const key of keys) sketch.add(key);

  expect(sketch.count()).toBe(new Set(keys).size);
  expect(claimed(code, "count\\(\\)")).toBe(sketch.count());
});

test("the README fuse sample quotes the bits/key the library reports", () => {
  const code = fuseSample();

  const size = claimed(code, "size");
  expect(size).toBe(3);
  expect(claimed(code, "bitsPerKey")).toBe(fuseBitsPerKey(size, 8));
});
