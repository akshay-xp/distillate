import { expect, test } from "vitest";

import {
  DDSKETCH_ACCURACY,
  DDSKETCH_EVENT_COUNTS,
  ddSketchAdapters,
  ddSketchRows,
} from "../src/ddsketch.js";

test("both sketches build at the shared accuracy and read it back", () => {
  for (const adapter of ddSketchAdapters) {
    expect(
      adapter.create(DDSKETCH_ACCURACY).relativeAccuracy,
      adapter.name,
    ).toBe(0.01);
  }
});

test("value counts stop at 1M", () => {
  expect(DDSKETCH_EVENT_COUNTS).toEqual([1e3, 1e4, 1e5, 1e6]);
});

test("rows measure accuracy, both sizes and throughput for each library", () => {
  const rows = ddSketchRows([1000]);
  expect(rows.map((r) => r.name)).toEqual([
    "distillate/ddsketch",
    "@datadog/sketches-js",
  ]);
  for (const r of rows) {
    expect(r.events).toBe(1000);
    expect(r.addOpsPerSec).toBeGreaterThan(0);
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.protoBytes).toBeGreaterThan(0);
  }
  // Measured, not assumed: the bound is the claim the section makes.
  expect(rows[0]?.maxRelError).toBeLessThanOrEqual(0.01 * (1 + 1e-12));
});
