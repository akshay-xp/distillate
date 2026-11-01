import { expect, test } from "vitest";

import { ALLOCATION_LIMIT, measureAllocation } from "../../bench/harness.js";
import { KllSketch } from "../../src/kll/kll.js";

// Alone in its file and in the single-worker project, for the reasons
// tests/hll/allocation.test.ts sets out. At k 200 a level-0 compaction runs
// about every hundred adds, so the window crosses thousands of them; a new
// level, the one add that allocates, comes only as n doubles. Level 15 lands
// at n = 3.49M, during the second warm-up, outside both windows.
//
// The first window is run and discarded, as in tests/ddsketch: 1 full-suite
// run in 270 on CI scavenged once, 6ms into it, with no repeat in the second.
// Second windows stayed at 0 in all 1,470 runs, so what the first catches is
// the settling of a loop this quick, which takes about 200ms from a cold start.
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

  await measureAllocation(addNext, 600_000);
  const { collections, bytesPerCall } = await measureAllocation(() => {
    at = (at + 1) & 65_535;
    sketch.add(values[at] ?? 0);
  }, 600_000);

  expect(collections).toBe(0);
  expect(bytesPerCall).toBeLessThan(ALLOCATION_LIMIT);
});
