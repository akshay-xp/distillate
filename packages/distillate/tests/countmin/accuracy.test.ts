import { expect, test } from "vitest";

import { truthOf, zipfStream } from "../helpers/frequency.js";

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
