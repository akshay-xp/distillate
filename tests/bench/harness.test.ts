import { expect, test } from "vitest";

import { hitMissPools } from "../../bench/harness.js";

test("hitMissPools returns disjoint hit and miss pools", () => {
  const { hit, miss } = hitMissPools(1000);
  expect(hit).toHaveLength(1000);
  expect(miss).toHaveLength(1000);
  expect(new Set([...hit, ...miss]).size).toBe(2000);
});
