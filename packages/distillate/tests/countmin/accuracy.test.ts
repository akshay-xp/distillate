import { expect, test } from "vitest";

import { hash32x2Into, probeAt } from "../../src/core/hasher.js";
import { CountMinSketch } from "../../src/countmin/countmin.js";
import {
  prefixedStream,
  scoreOverestimate,
  truthOf,
  uniformStream,
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

test.each<[string, (seed: number) => string[]]>([
  ["uniform", (seed) => uniformStream(seed, DISTINCT, EVENTS)],
  // Keys sharing a 64-character head, which is what catches a hash that
  // under-mixes the front of a key.
  ["prefixed", (seed) => prefixedStream(seed, DISTINCT, EVENTS)],
])("the error bound holds on a %s stream", (_, build) => {
  const s = CountMinSketch.create(0.001, 0.001);
  const stream = build(12);
  for (const key of stream) s.add(key);

  const score = scoreOverestimate(
    (key) => s.count(key),
    truthOf(stream),
    s.error(),
  );

  expect(score.violations).toBeLessThanOrEqual(s.delta * score.keys);
  expect(score.mean).toBeLessThan(s.error());
});

// The property in doubt: all d positions come from one 128-bit hash, so if the
// rows were correlated the minimum across them would buy nothing and this
// ratio would sit near 1. Independent rows put it near 1/depth.
test("extra rows reduce error the way independent rows would", () => {
  const stream = zipfStream(13, DISTINCT, EVENTS, 1);
  const truth = truthOf(stream);
  const meanOver = (depth: number): number => {
    const s = new CountMinSketch({ width: 2719, depth });
    for (const key of stream) s.add(key);
    return scoreOverestimate((key) => s.count(key), truth, Infinity).mean;
  };

  expect(meanOver(7)).toBeLessThan(0.4 * meanOver(1));
});

// The fallback this kernel was chosen over: one independent hash pass per row,
// seeded by the row, which is Redis's CMS_HASH(item, len, i) shape. It costs
// depth hash passes per operation instead of one, so it only earns that if it
// is measurably more accurate. Built here as a throwaway oracle to find out.
function perRowOracle(
  width: number,
  depth: number,
): { add: (key: string) => void; count: (key: string) => number } {
  const counters = new Uint32Array(width * depth);
  const words = new Uint32Array(2);
  const at = (key: string, row: number): number => {
    // Offset so no row coincides with the sketch under test, which shares the
    // library default seed 0.
    hash32x2Into(key, 0x9e3779b9 + row, words);
    return row * width + probeAt(words[0] ?? 0, words[1] ?? 0, 0, width);
  };
  return {
    add(key) {
      for (let r = 0; r < depth; r++) counters[at(key, r)]++;
    },
    count(key) {
      let min = Infinity;
      for (let r = 0; r < depth; r++) {
        const v = counters[at(key, r)] ?? 0;
        if (v < min) min = v;
      }
      return min;
    },
  };
}

test("derived positions are no worse than per-row hashing", () => {
  const stream = zipfStream(14, DISTINCT, EVENTS, 1);
  const truth = truthOf(stream);
  const s = CountMinSketch.create(0.001, 0.001);
  const oracle = perRowOracle(s.width, s.depth);
  for (const key of stream) {
    s.add(key);
    oracle.add(key);
  }

  const mine = scoreOverestimate((key) => s.count(key), truth, Infinity);
  const theirs = scoreOverestimate((key) => oracle.count(key), truth, Infinity);

  expect(mine.mean).toBeLessThanOrEqual(1.5 * theirs.mean);
});
