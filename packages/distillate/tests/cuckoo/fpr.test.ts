import { expect, test } from "vitest";

import { CuckooFilter } from "../../src/cuckoo/cuckoo.js";
import { measureFpr, sampleStrings } from "../helpers/fpr.js";

// 1.25x is the statistical suite's tolerance. Each target lands on a
// different fingerprint width (9, 10 and 13 bits).
test.each([0.03, 0.01, 0.001])(
  "at n keys the false-positive rate holds its target of %d",
  (epsilon) => {
    const f = CuckooFilter.create(100_000, epsilon);
    const fpr = measureFpr(
      f,
      sampleStrings(25, 100_000),
      sampleStrings(26, 100_000),
    );

    expect(fpr).toBeLessThanOrEqual(1.25 * epsilon);
    expect(f.rate()).toBeGreaterThan(0);
    expect(f.rate()).toBeLessThanOrEqual(1.25 * epsilon);
  },
);

test("an empty filter estimates a zero rate", () => {
  expect(CuckooFilter.create(1000, 0.01).rate()).toBe(0);
});
