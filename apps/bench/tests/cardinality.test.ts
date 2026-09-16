import { expect, test } from "vitest";

import {
  cardinalityAdapters,
  cardinalityBenchLabels,
  cardinalityRows,
} from "../src/cardinality.js";
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

test("cardinality rows carry serialized bytes and name the format", () => {
  const rows = cardinalityRows(12, [20_000]);
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
