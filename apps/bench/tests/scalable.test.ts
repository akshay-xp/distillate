import { expect, test } from "vitest";

import { TARGET_FPR } from "../src/adapters.js";
import {
  distillateScalableAdapter,
  SCALABLE_INITIAL,
  SCALABLE_KEY_COUNTS,
  scalableAdapters,
  scalableRows,
} from "../src/scalable.js";

test("scalable adapters build at the incumbent's default settings", () => {
  expect(scalableAdapters.map((a) => a.name)).toEqual([
    "distillate/scalable",
    "bloom-filters",
  ]);

  for (const a of scalableAdapters) {
    const f = a.create(SCALABLE_INITIAL, TARGET_FPR);
    // Read back from each library's own filter, so a mismatch in either
    // adapter shows up here rather than in the numbers.
    expect(f.settings, a.name).toEqual({
      initialSize: 1000,
      errorRate: 0.01,
      growth: 2,
      tightening: 0.5,
    });
    f.add("a");
    expect(f.has("a"), a.name).toBe(true);
    expect(f.stages(), a.name).toBeGreaterThanOrEqual(1);
    expect(f.bits(), a.name).toBeGreaterThan(0);
  }
});

test("scalable rows measure throughput, space, stages and FPR per key count", () => {
  const rows = scalableRows(SCALABLE_INITIAL, [1_000, 10_000]);
  expect(rows).toHaveLength(4);
  for (const r of rows) {
    expect(r.bitsPerKey, r.name).toBeGreaterThan(0);
    expect(r.measuredFpr).toBeGreaterThanOrEqual(0);
    expect(r.measuredFpr).toBeLessThanOrEqual(1);
    for (const rate of [r.addOpsPerSec, r.hasOpsPerSec]) {
      expect(Number.isFinite(rate) && rate > 0).toBe(true);
    }
  }
  for (const a of scalableAdapters) {
    const [small, large] = rows.filter((r) => r.name === a.name);
    expect(large?.stages ?? 0, a.name).toBeGreaterThan(small?.stages ?? 0);
  }
});

test("the sweep runs from one to a hundred times the initial size", () => {
  expect(SCALABLE_KEY_COUNTS).toEqual([1_000, 10_000, 100_000]);
});

// The headline claim for distillate's side; the incumbent's row is what is
// being measured, so it carries no assertion.
test("distillate holds its target at a hundred times its initial size", () => {
  const [row] = scalableRows(
    SCALABLE_INITIAL,
    [100_000],
    [distillateScalableAdapter],
  );
  expect(row?.name).toBe("distillate/scalable");
  expect(row?.measuredFpr).toBeLessThanOrEqual(0.0125);
});
