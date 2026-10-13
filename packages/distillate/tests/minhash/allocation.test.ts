import { expect, test } from "vitest";

import { countCollections } from "../../bench/harness.js";
import { MinHashLSH } from "../../src/minhash/lsh.js";
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

// The reads a caller repeats while confirming LSH candidates. A sparse sketch
// at k 512 makes densification the costly path if it ever reran. The first
// window is discarded, as tests/ddsketch/allocation.test.ts explains.
test("jaccard, equals and has allocate nothing on unchanged inputs", async () => {
  const a = new MinHash({ k: 512 });
  const b = new MinHash({ k: 512 });
  for (let i = 0; i < 40; i++) {
    a.add(`a:${String(i)}`);
    b.add(`a:${String(i + 10)}`);
  }
  const lsh = new MinHashLSH<string>({ threshold: 0.5, k: 512 });
  lsh.insert("a", a);

  // Counted as an integer: adding each double estimate to a captured variable
  // boxes it, a collection the probe would charge to jaccard.
  let sink = 0;
  const read = (): void => {
    if (a.jaccard(b) > 0) sink++;
    if (a.equals(b)) sink++;
    if (lsh.has("a")) sink++;
  };
  for (let i = 0; i < 10_000; i++) read();
  await countCollections(() => {
    read();
  }, 200_000);
  const collections = await countCollections(() => {
    read();
  }, 200_000);

  expect(collections).toBe(0);
  expect(sink).toBeGreaterThan(0);
});
