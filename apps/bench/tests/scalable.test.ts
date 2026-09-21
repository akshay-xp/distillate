import { expect, test } from "vitest";

import { TARGET_FPR } from "../src/adapters.js";
import { SCALABLE_INITIAL, scalableAdapters } from "../src/scalable.js";

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
