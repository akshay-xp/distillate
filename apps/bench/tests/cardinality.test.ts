import { expect, test } from "vitest";

import { cardinalityAdapters, cardinalityRows } from "../src/cardinality.js";
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

test("cardinality rows carry the measured relative error", () => {
  const p = 12;
  const rows = cardinalityRows(p, [1_000, 20_000]);
  expect(rows).toHaveLength(4);

  for (const r of rows) {
    expect(r.p).toBe(p);
    expect(r.registers).toBe(4096);
    expect(r.relativeError).toBeCloseTo(Math.abs(r.estimate - r.n) / r.n, 12);
  }

  // Twice the theoretical standard error: a real bound without being flaky.
  const bound = (2 * 1.04) / Math.sqrt(2 ** p);
  for (const r of rows.filter((r) => r.name === "distillate/hll")) {
    expect(r.relativeError).toBeLessThanOrEqual(bound);
  }
});
