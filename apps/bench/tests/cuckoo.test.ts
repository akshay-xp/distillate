import { expect, test } from "vitest";

import { TARGET_FPR } from "../src/adapters.js";
import {
  CUCKOO_KEY_COUNTS,
  cuckooAdapters,
  cuckooRows,
  distillateCuckooAdapter,
} from "../src/cuckoo.js";

test("cuckoo adapters build at matched settings and read them back", () => {
  expect(cuckooAdapters.map((a) => a.name)).toEqual([
    "distillate/cuckoo",
    "bloom-filters",
  ]);

  // Read back from each library's own filter, so a mismatch in either adapter
  // shows up here rather than in the numbers. The fingerprint width is the one
  // setting that differs: the incumbent's is ceil(f / 8) hex characters.
  const [ours, theirs] = cuckooAdapters.map((a) => a.create(1000, TARGET_FPR));
  const shared = { n: 1000, errorRate: 0.01, bucketSize: 4, maxKicks: 500 };
  expect(ours?.settings).toEqual({ ...shared, fingerprintBits: 10 });
  expect(theirs?.settings).toEqual({ ...shared, fingerprintBits: 8 });

  for (const a of cuckooAdapters) {
    const f = a.create(1000, TARGET_FPR);
    expect(f.add("a"), a.name).toBe(true);
    expect(f.has("a"), a.name).toBe(true);
    expect(f.delete("a"), a.name).toBe(true);
    expect(f.has("a"), a.name).toBe(false);
    expect(f.bits(), a.name).toBeGreaterThan(0);
  }
});

test("cuckoo rows measure throughput, space, FPR and lost keys", () => {
  const rows = cuckooRows([1_000, 10_000]);
  expect(rows).toHaveLength(4);
  for (const r of rows) {
    expect(r.bitsPerKey, r.name).toBeGreaterThan(0);
    expect(r.measuredFpr).toBeGreaterThanOrEqual(0);
    expect(r.measuredFpr).toBeLessThanOrEqual(1);
    for (const rate of [r.addOpsPerSec, r.hasOpsPerSec, r.deleteOpsPerSec]) {
      expect(Number.isFinite(rate) && rate > 0).toBe(true);
    }
    for (const count of [r.lostAfterBuild, r.lostAfterDelete, r.refused]) {
      expect(Number.isInteger(count)).toBe(true);
    }
  }
});

test("the sweep runs to ten million keys, like every structure", () => {
  expect(CUCKOO_KEY_COUNTS).toEqual([
    1_000, 10_000, 100_000, 1_000_000, 10_000_000,
  ]);
});

// The headline claim for distillate's side; the incumbent's row is what is
// being measured, so it carries no assertion.
test("distillate loses no key and holds its target at a hundred thousand", () => {
  const [row] = cuckooRows([100_000], [distillateCuckooAdapter]);
  expect(row).toMatchObject({
    name: "distillate/cuckoo",
    lostAfterBuild: 0,
    lostAfterDelete: 0,
    refused: 0,
  });
  expect(row?.measuredFpr).toBeLessThanOrEqual(0.0125);
});
