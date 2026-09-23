import { expect, test } from "vitest";

import { CountMinSketch } from "../../src/countmin/countmin.js";
import {
  scoreOverestimate,
  truthOf,
  zipfStream,
} from "../helpers/frequency.js";

test("zipfStream is deterministic for a given seed", () => {
  expect(zipfStream(1, 1000, 10_000, 1)).toEqual(
    zipfStream(1, 1000, 10_000, 1),
  );
  expect(zipfStream(1, 1000, 10_000, 1)).not.toEqual(
    zipfStream(2, 1000, 10_000, 1),
  );
});

test("zipfStream emits the asked-for events over the asked-for key space", () => {
  const stream = zipfStream(3, 1000, 10_000, 1);
  const truth = truthOf(stream);

  expect(stream).toHaveLength(10_000);
  expect(truth.size).toBeLessThanOrEqual(1000);
  expect([...truth.values()].reduce((a, b) => a + b, 0)).toBe(10_000);
});

// A stream that is merely noisy would not exercise the sketch the way a real
// frequency workload does, so assert the skew is genuinely heavy-tailed.
test("zipfStream is heavily skewed, not near-uniform", () => {
  const counts = [...truthOf(zipfStream(4, 1000, 100_000, 1)).values()].sort(
    (a, b) => b - a,
  );
  const median = counts[counts.length >> 1] ?? 0;

  expect(counts[0] ?? 0).toBeGreaterThanOrEqual(10 * median);
});

const EVENTS = 1_000_000;
const DISTINCT = 100_000;

// The contract is per query, so a correct sketch is expected to exceed the
// bound on about `delta` of the keys, not on none of them. Asserting zero
// would be flaky against a good kernel.
test("the error bound holds on a Zipf stream", () => {
  const s = CountMinSketch.create(0.001, 0.001);
  const stream = zipfStream(11, DISTINCT, EVENTS, 1);
  for (const key of stream) s.add(key);

  const score = scoreOverestimate(
    (key) => s.count(key),
    truthOf(stream),
    s.error(),
  );

  expect(score.violations).toBeLessThanOrEqual(s.delta * score.keys);
  expect(score.mean).toBeLessThan(s.error());
  expect(Number.isFinite(score.max)).toBe(true);
});
