import { expect, test } from "vitest";

import {
  scoreTopK,
  TOPK_DELTA,
  TOPK_EPSILON,
  TOPK_EVENT_COUNTS,
  TOPK_K,
  topKAdapters,
  topKRows,
} from "../src/topk.js";

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

// Keys tied at the k-th count are interchangeable: any of them completes a
// correct top-k, so a tie-break the scorer did not expect costs nothing. What
// does cost is leaving out a key strictly heavier than the k-th.
test("scoreTopK does not penalise a correct tie-break", () => {
  const truth = new Map([
    ["a", 5],
    ["b", 4],
    ["c", 3],
    ["d", 3],
    ["e", 1],
  ]);
  const both = (p: number) => ({ precision: p, recall: p });

  expect(scoreTopK(["a", "b", "d"], truth, 3)).toEqual(both(1));
  expect(scoreTopK(["a", "b", "c"], truth, 3)).toEqual(both(1));
  expect(scoreTopK(["a", "c", "d"], truth, 3)).toEqual(both(2 / 3));
  expect(scoreTopK(["a", "b", "e"], truth, 3)).toEqual(both(2 / 3));
  expect(scoreTopK(["a", "b"], truth, 3)).toEqual({
    precision: 1,
    recall: 2 / 3,
  });
  expect(scoreTopK([], truth, 3)).toEqual(both(0));

  // Fewer distinct keys than k: the whole key set is the right answer.
  const small = new Map([
    ["a", 2],
    ["b", 1],
  ]);
  expect(scoreTopK(["a", "b"], small, 3)).toEqual(both(1));
});

// The cap applied after the incumbent's HLL took about 21 minutes at 10M.
test("top-k event counts stop at 1M", () => {
  expect(Math.max(...TOPK_EVENT_COUNTS)).toBe(1_000_000);
});

test("top-k rows measure space, precision, recall and throughput", () => {
  const rows = topKRows([1_000, 10_000]);

  expect(rows).toHaveLength(4);
  for (const r of rows) {
    expect(r.bytes, r.name).toBeGreaterThan(0);
    for (const share of [r.precision, r.recall]) {
      expect(share, r.name).toBeGreaterThanOrEqual(0);
      expect(share, r.name).toBeLessThanOrEqual(1);
    }
    expect(Number.isFinite(r.addOpsPerSec) && r.addOpsPerSec > 0, r.name).toBe(
      true,
    );
  }
  // A held key never reads below its truth, so no returned key of ours may.
  for (const r of rows.filter((r) => r.name === "distillate/topk")) {
    expect(r.underestimates, `${r.name} ${r.events}`).toBe(0);
  }
});
