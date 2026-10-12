import { expect, test } from "vitest";

import { countCollections } from "../../bench/harness.js";
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
// The bitwise add is fast enough that countCollections' own warm-up ends
// before V8's background compile does, and finishing that compile inside the
// window cost one collection that a second window, or ten times the adds,
// never repeats.
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
    const collections = await countCollections(() => {
      at = (at + 1) & 4095;
      sketch.add(values[at] ?? 0);
    }, 6_000_000);

    expect(collections).toBe(0);
  },
);
