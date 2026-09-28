import { expect, test } from "vitest";

import { TOPK_DELTA, TOPK_EPSILON, TOPK_K, topKAdapters } from "../src/topk.js";

test("top-k adapters build at a comparable configuration and read it back", () => {
  expect(topKAdapters.map((a) => a.name)).toEqual([
    "distillate/topk",
    "bloom-filters",
  ]);

  // Read back from each library's own object, so a mismatch in either adapter
  // shows up here rather than in the numbers.
  const [ours, theirs] = topKAdapters.map((a) =>
    a.create(TOPK_EPSILON, TOPK_DELTA, TOPK_K),
  );
  expect(ours?.settings).toEqual({ capacity: 4096 });
  expect(theirs?.settings).toEqual({ width: 2719, depth: 7, k: 100 });

  for (const a of topKAdapters) {
    const s = a.create(TOPK_EPSILON, TOPK_DELTA, TOPK_K);
    s.add("a");
    s.add("a");
    s.add("a");
    s.add("b");

    const [first] = s.top(2);
    expect(first?.key, a.name).toBe("a");
    expect(first?.estimate, a.name).toBeGreaterThanOrEqual(3);
    expect(s.bytes(), a.name).toBeGreaterThan(0);
  }
});
