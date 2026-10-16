import { createHash } from "node:crypto";

import { expect, test } from "vitest";

import { RibltEncoder } from "../../src/riblt/encoder.js";

// The frames an encoder streams, pinned by digest. XOR and the count sum do
// not depend on the order a window folds symbols in, so any change to how it
// orders them must leave every byte as it was.
test("the encoder's frames are pinned across set sizes, seeds and frame sizes", () => {
  const hash = createHash("sha256");
  for (const [n, seed] of [
    [0, 0],
    [1, 3],
    [500, 7],
    [20_000, 1],
    [20_000, 4_000_000_000],
  ] as const) {
    const keys = Array.from({ length: n }, (_, i) => `k:${String(i)}`);
    const encoder = RibltEncoder.from(keys, { seed });
    for (const size of [1, 7, 64, 100]) {
      for (let f = 0; f < 40; f++) hash.update(encoder.take(size));
    }
  }

  expect(hash.digest("hex")).toBe(
    "cab5a0634b13e6d355bdd53497ffe331c79e5643a61b3b6f0f94bf4732b89b8f",
  );
});
