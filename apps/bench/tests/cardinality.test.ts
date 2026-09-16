import { expect, test } from "vitest";

import { cardinalityAdapters } from "../src/cardinality.js";
import { hitMissPools } from "../src/harness.js";

test("cardinality adapters build at a matched register count", () => {
  expect(cardinalityAdapters.map((a) => a.name)).toEqual([
    "distillate/hll",
    "bloom-filters",
  ]);

  const hit = hitMissPools(20_000).hit;
  for (const a of cardinalityAdapters) {
    const sketch = a.create(12);
    expect(sketch.registers).toBe(4096);
    for (const key of hit) sketch.add(key);
    expect(sketch.count()).toBeGreaterThan(20_000 * 0.9);
    expect(sketch.count()).toBeLessThan(20_000 * 1.1);
  }
});
