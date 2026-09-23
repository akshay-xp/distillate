import { expect, test } from "vitest";

import {
  COUNTMIN_DELTA,
  COUNTMIN_EPSILON,
  countMinAdapters,
  zipfStream,
} from "../src/countmin.js";

test("count-min adapters build at a matched geometry and read it back", () => {
  expect(countMinAdapters.map((a) => a.name)).toEqual([
    "distillate/countmin",
    "bloom-filters",
  ]);

  // Read back from each library's own sketch, so a mismatch in either adapter
  // shows up here rather than in the numbers.
  const [ours, theirs] = countMinAdapters.map((a) =>
    a.create(COUNTMIN_EPSILON, COUNTMIN_DELTA),
  );
  const geometry = { width: 2719, depth: 7 };

  expect(ours?.settings).toEqual(geometry);
  expect(theirs?.settings).toEqual(geometry);

  for (const a of countMinAdapters) {
    const s = a.create(COUNTMIN_EPSILON, COUNTMIN_DELTA);
    s.add("a", 3);
    s.add("a");

    expect(s.count("a"), a.name).toBeGreaterThanOrEqual(4);
    expect(s.count("never-seen"), a.name).toBe(0);
    expect(s.bytes(), a.name).toBeGreaterThan(0);
  }
});

test("zipfStream is deterministic and heavily skewed", () => {
  const a = zipfStream(1, 500, 5_000);

  expect(a).toHaveLength(5_000);
  expect(a).toEqual(zipfStream(1, 500, 5_000));
  expect(a).not.toEqual(zipfStream(2, 500, 5_000));

  const counts = new Map<string, number>();
  for (const key of a) counts.set(key, (counts.get(key) ?? 0) + 1);
  const sorted = [...counts.values()].sort((x, y) => y - x);

  // A near-uniform stream would hide the collisions between one heavy key and
  // the light tail sharing its column, which is what the sketch is judged on.
  expect(sorted[0] ?? 0).toBeGreaterThanOrEqual(
    10 * (sorted[sorted.length >> 1] ?? 0),
  );
});
