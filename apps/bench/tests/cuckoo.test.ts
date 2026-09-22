import { expect, test } from "vitest";

import { TARGET_FPR } from "../src/adapters.js";
import { cuckooAdapters } from "../src/cuckoo.js";

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
