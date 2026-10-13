import { expect, test } from "vitest";

import { countCollections } from "../../bench/harness.js";
import { MinHash } from "../../src/minhash/minhash.js";

// Lives alone in its file and runs in the allocation project at maxWorkers 1,
// for the reasons tests/hll/allocation.test.ts sets out.
test("add allocates nothing in steady state", async () => {
  const sketch = new MinHash();
  const keys: string[] = [];
  for (let i = 0; i < 4096; i++) keys.push(`alloc:${String(i)}`);
  for (const key of keys) sketch.add(key);

  let at = 0;
  const collections = await countCollections(() => {
    at = (at + 1) & 4095;
    sketch.add(keys[at] ?? "");
  }, 600_000);

  expect(collections).toBe(0);
});
