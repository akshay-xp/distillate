import { expect, test } from "vitest";

import {
  DDSKETCH_ACCURACY,
  DDSKETCH_TIMED_PASSES,
  DDSKETCH_WARM_PASSES,
  distillateDDSketchAdapter,
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
    "distillate/ddsketch (log)",
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

// One pass in a fresh process measures how fast V8 tiers each library up, not
// how fast it adds: at 10k values the gap between the two was 35% cold and 1%
// warm. Each row is the median of timed passes, after warm ones, on a fresh
// sketch each pass, as the key-length section does.
test("each row times warm passes on fresh sketches and keeps the median", () => {
  let sketches = 0;
  let adds = 0;
  const counting = {
    ...distillateDDSketchAdapter,
    create(relativeAccuracy: number) {
      sketches++;
      const s = distillateDDSketchAdapter.create(relativeAccuracy);
      return {
        ...s,
        add(v: number) {
          adds++;
          s.add(v);
        },
      };
    },
  };
  ddSketchRows([100], [counting]);
  expect(DDSKETCH_WARM_PASSES).toBe(2);
  expect(DDSKETCH_TIMED_PASSES).toBe(5);
  expect(sketches).toBe(DDSKETCH_WARM_PASSES + DDSKETCH_TIMED_PASSES);
  expect(adds).toBe((DDSKETCH_WARM_PASSES + DDSKETCH_TIMED_PASSES) * 100);
});
