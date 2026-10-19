import { expect, test } from "vitest";

import { ALLOCATION_LIMIT, measureAllocation } from "../../bench/harness.js";
import { KllSketch } from "../../src/kll/kll.js";

// Alone in its file and in the single-worker project, for the reasons
// tests/hll/allocation.test.ts sets out. At k 200 a level-0 compaction runs
// about every hundred adds, so the window crosses thousands of them; a new
// level, the one add that allocates, comes only as n doubles.
test("add allocates nothing in steady state, compactions included", async () => {
  const sketch = new KllSketch({ seed: 1 });
  const values = new Float64Array(65_536);
  for (let i = 0; i < values.length; i++) values[i] = Math.random();
  let at = 0;
  const addNext = (): void => {
    at = (at + 1) & 65_535;
    sketch.add(values[at] ?? 0);
  };
  for (let i = 0; i < 2_000_000; i++) addNext();

  const { collections, bytesPerCall } = await measureAllocation(
    addNext,
    600_000,
  );

  expect(collections).toBe(0);
  expect(bytesPerCall).toBeLessThan(ALLOCATION_LIMIT);
});
