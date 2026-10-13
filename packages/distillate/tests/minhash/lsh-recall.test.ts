import { expect, test } from "vitest";

import { MinHashLSH } from "../../src/minhash/lsh.js";
import { MinHash } from "../../src/minhash/minhash.js";

// The balanced split puts the candidate curve's midpoint near the threshold,
// so at t + 0.1 a pair is found only about 87% of the time (t 0.5, k 128 picks
// 25 bands of 5 rows). The gate sits where the curve has settled: t + 0.2,
// where theory gives 0.99, and t - 0.3, where it gives under 0.01.
const PAIRS = 200;
const THRESHOLD = 0.5;

function sketchOf(prefix: string, shared: number, unique: number): MinHash {
  const sketch = new MinHash();
  for (let i = 0; i < shared; i++) sketch.add(`${prefix}:s:${String(i)}`);
  for (let i = 0; i < unique; i++) sketch.add(`${prefix}:u:${String(i)}`);
  return sketch;
}

// Base and partner share `shared` items and hold `unique` of their own each,
// so J = shared / (shared + 2 * unique).
function foundRate(shared: number, unique: number): number {
  const lsh = new MinHashLSH<number>({ threshold: THRESHOLD });
  for (let p = 0; p < PAIRS; p++) {
    lsh.insert(p, sketchOf(`p${String(p)}`, shared, unique));
  }

  let found = 0;
  for (let p = 0; p < PAIRS; p++) {
    const partner = sketchOf(`p${String(p)}`, shared, 0);
    for (let i = 0; i < unique; i++)
      partner.add(`q${String(p)}:u:${String(i)}`);
    if (lsh.query(partner).includes(p)) found++;
  }
  return found / PAIRS;
}

test("pairs at J = threshold + 0.2 are found at least 95% of the time", () => {
  expect(foundRate(2000, 412)).toBeGreaterThanOrEqual(0.95);
});

test("pairs at J = threshold - 0.3 are found at most 5% of the time", () => {
  expect(foundRate(334, 666)).toBeLessThanOrEqual(0.05);
});
