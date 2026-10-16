import { expect, test } from "vitest";

import { ALLOCATION_LIMIT, measureAllocation } from "../../bench/harness.js";
import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import { logMapping } from "../../src/ddsketch/mapping.js";
import { lognormalValues } from "../helpers/quantile.js";

// Alone in its file and in vitest's allocation project for the reasons
// tests/hll/allocation.test.ts gives: collections are per-isolate, and a
// loaded machine changes what V8 inlines.
//
// Values are pre-generated, of both signs, and cycled through first so the
// bins they need exist: growing the store is allowed to allocate, a
// steady-state add is not. The cycling runs far longer than the bins need.
// The bitwise add is fast enough that measureAllocation' own warm-up ends
// before V8's background compile does, and finishing that compile inside the
// window costs one collection that a second window never repeats. A longer
// pre-warm alone did not hold under load (3 of 5 full runs failed on a
// reviewer's laptop), so the first window is run and discarded.
test.each([
  ["the defaults", {}],
  ["the log mapping", { mapping: logMapping }],
] as const)(
  "add allocates nothing in steady state on %s",
  async (_, options) => {
    const values = lognormalValues(31, 4096).map((v, i) =>
      i % 3 === 0 ? -v : v,
    );
    const sketch = DDSketch.create(0.01, options);
    for (let i = 0; i < 2_000_000; i++) sketch.add(values[i & 4095] ?? 0);

    let at = 0;
    // Two closures, not one passed twice: on Node 22 a shared one measured
    // 11 to 23 collections on the log mapping, every run.
    await measureAllocation(() => {
      at = (at + 1) & 4095;
      sketch.add(values[at] ?? 0);
    }, 6_000_000);
    const { collections, bytesPerCall } = await measureAllocation(() => {
      at = (at + 1) & 4095;
      sketch.add(values[at] ?? 0);
    }, 6_000_000);

    expect(collections).toBe(0);

    expect(bytesPerCall).toBeLessThan(ALLOCATION_LIMIT);
  },
);
