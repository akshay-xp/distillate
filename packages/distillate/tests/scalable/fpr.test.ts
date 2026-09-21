import { expect, test } from "vitest";

import {
  ScalableBloomFilter,
  type ScalableBloomParams,
} from "../../src/scalable/scalable.js";
import { measureFpr, sampleStrings } from "../helpers/fpr.js";

// The whole point of the structure: a hundred times its initial n and the
// chain's false-positive rate is still epsilon, where a Bloom filter sized for
// n would be saturated. 1.25x is the statistical suite's tolerance.
test.each<[string, Partial<ScalableBloomParams>, number]>([
  ["default settings", {}, 6],
  ["growth 4, tightening 0.5", { growth: 4, tightening: 0.5 }, 4],
])(
  "the false-positive bound holds after 100x growth (%s)",
  (_, options, minStages) => {
    const f = new ScalableBloomFilter({ n: 1000, epsilon: 0.01, ...options });
    const fpr = measureFpr(
      f,
      sampleStrings(11, 100_000),
      sampleStrings(12, 100_000),
    );

    expect(f.stages).toBeGreaterThanOrEqual(minStages);
    expect(fpr).toBeLessThanOrEqual(0.0125);
    expect(f.rate()).toBeLessThanOrEqual(0.0125);
  },
);
