import { expect, test } from "vitest";

import { ALLOCATION_LIMIT, measureAllocation } from "../../bench/harness.js";
import { ThetaSketch } from "../../src/theta/theta.js";

// Lives alone in its file and runs in the allocation project at maxWorkers 1,
// for the reasons tests/hll/allocation.test.ts sets out. Every key is fresh,
// written into one reused buffer, so the window crosses rebuilds rather than
// rejecting repeats.
test("add allocates nothing in steady state, rebuilds included", async () => {
  const sketch = new ThetaSketch({ k: 4096 });
  const key = new Uint8Array(8);
  const view = new DataView(key.buffer);
  let at = 0;
  const addNext = (): void => {
    view.setUint32(0, at++, true);
    sketch.add(key);
  };
  for (let i = 0; i < 50_000; i++) addNext();
  const before = sketch.theta;

  const { collections, bytesPerCall } = await measureAllocation(
    addNext,
    600_000,
  );

  expect(collections).toBe(0);

  expect(bytesPerCall).toBeLessThan(ALLOCATION_LIMIT);
  expect(sketch.theta).toBeLessThan(before);
});
