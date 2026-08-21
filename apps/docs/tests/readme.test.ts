import { fileURLToPath } from "node:url";

import { fuseBitsPerKey } from "distillate/fuse";
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
test("the README fuse sample quotes the bits/key the library reports", () => {
  const code = fuseSample();

  const size = claimed(code, "size");
  expect(size).toBe(3);
  expect(claimed(code, "bitsPerKey")).toBe(fuseBitsPerKey(size, 8));
});
