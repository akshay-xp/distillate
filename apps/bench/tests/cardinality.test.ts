import { expect, test } from "vitest";

import {
  cardinalityAdapters,
  cardinalityBenchLabels,
  cardinalityRows,
  incumbentHllAdapter,
} from "../src/cardinality.js";
import type { MeasuredCardinalityRow } from "../src/cardinality.js";
import { hitMissPools } from "../src/harness.js";

const measured = (p: number, ns: number[]): MeasuredCardinalityRow[] =>
  cardinalityRows(p, ns).filter(
    (r): r is MeasuredCardinalityRow => !("notRun" in r),
  );

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
  const rows = measured(p, [1_000, 20_000]);
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

test("cardinality rows carry serialized bytes and name the format", () => {
  const rows = measured(12, [20_000]);
  const distillate = rows.find((r) => r.name === "distillate/hll")!;
  const incumbent = rows.find((r) => r.name === "bloom-filters")!;

  expect(distillate.format).toBe("binary");
  // Dense payload at p = 12 is 2 ** 12 * 6 / 8 bytes, plus the header.
  expect(distillate.bytes).toBeGreaterThan((2 ** 12 * 6) / 8 - 64);
  expect(distillate.bytes).toBeLessThan((2 ** 12 * 6) / 8 + 64);

  expect(incumbent.format).toBe("json");
  expect(incumbent.bytes).toBeGreaterThan(distillate.bytes);

  expect(distillate.format).not.toBe(incumbent.format);
});

test("cardinality bench labels distinguish the sketch from the filter benches", () => {
  expect(cardinalityBenchLabels()).toEqual([
    "distillate/hll add",
    "distillate/hll count",
    "bloom-filters hll add",
    "bloom-filters hll count",
  ]);
});

test("cardinality rows carry the time taken to build the sketch", () => {
  const rows = measured(12, [20_000]);
  for (const r of rows) {
    expect(r.buildMs).toBeGreaterThan(0);
    expect(r.addOpsPerSec).toBeCloseTo(r.n / (r.buildMs / 1000), 6);
  }
  // The incumbent is the slow one; this is the gap the sweep exists to show.
  const distillate = rows.find((r) => r.name === "distillate/hll")!;
  const incumbent = rows.find((r) => r.name === "bloom-filters")!;
  expect(distillate.buildMs).toBeLessThan(incumbent.buildMs);
});

test("the incumbent is capped at 1M, and a row past its cap projects its build", () => {
  expect(incumbentHllAdapter.maxKeys).toBe(1_000_000);

  const capped = { ...incumbentHllAdapter, maxKeys: 1_000 };
  const [measured, skipped] = cardinalityRows(10, [1_000, 4_000], [capped]);
  if (!measured || "notRun" in measured) {
    throw new Error("the first row should be measured");
  }
  expect(skipped).toMatchObject({
    name: "bloom-filters",
    n: 4_000,
    notRun: true,
  });
  // Its add rate is flat, so the build scales linearly with n.
  expect(
    skipped && "projectedBuildMs" in skipped && skipped.projectedBuildMs,
  ).toBeCloseTo(measured.buildMs * 4, 6);
});
