import { expect, test } from "vitest";

import { TARGET_FPR } from "../src/adapters.js";
import {
  distillateScalableAdapter,
  incumbentScalableAdapter,
  SCALABLE_INITIAL,
  SCALABLE_KEY_COUNTS,
  scalableAdapters,
  scalableRows,
} from "../src/scalable.js";
import type { MeasuredScalableRow, ScalableRow } from "../src/scalable.js";

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

// Rows under every cap are measured; this narrows them for the assertions.
const measured = (rows: ScalableRow[]): MeasuredScalableRow[] =>
  rows.filter((r): r is MeasuredScalableRow => !("notRun" in r));

test("scalable rows measure throughput, space, stages and FPR per key count", () => {
  const rows = measured(scalableRows(SCALABLE_INITIAL, [1_000, 10_000]));
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

test("the sweep runs from one to ten thousand times the initial size", () => {
  expect(SCALABLE_KEY_COUNTS).toEqual([
    1_000, 10_000, 100_000, 1_000_000, 10_000_000,
  ]);
});

// The headline claim for distillate's side; the incumbent's row is what is
// being measured, so it carries no assertion.
test("distillate holds its target at a hundred times its initial size", () => {
  const [row] = measured(
    scalableRows(SCALABLE_INITIAL, [100_000], [distillateScalableAdapter]),
  );
  expect(row?.name).toBe("distillate/scalable");
  expect(row?.measuredFpr).toBeLessThanOrEqual(0.0125);
});

// Its build is quadratic in the key count (every add recounts the newest
// stage), so past its cap a row projects the build time instead of measuring.
test("the incumbent is capped, and a row past its cap projects its build", () => {
  expect(incumbentScalableAdapter.maxKeys).toBe(100_000);

  const capped = { ...incumbentScalableAdapter, maxKeys: 1_000 };
  const [measured, skipped] = scalableRows(
    SCALABLE_INITIAL,
    [1_000, 4_000],
    [capped],
  );
  if (!measured || !("addOpsPerSec" in measured)) {
    throw new Error("the first row should be measured");
  }
  expect(skipped).toMatchObject({
    name: "bloom-filters",
    keys: 4_000,
    notRun: true,
  });
  const buildMs = (1_000 / measured.addOpsPerSec) * 1000;
  expect(
    skipped && "projectedBuildMs" in skipped && skipped.projectedBuildMs,
  ).toBeCloseTo(buildMs * 16, 6);
});
