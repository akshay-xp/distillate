import { expect, test } from "vitest";

import { ThetaSketch } from "../../src/theta/theta.js";

const TRIALS = 200;
const SDS = [1, 2, 3] as const;

// Measured when the gate was written: every cell's mean sat within 1.93
// standard errors of the mean, and a single stream's relative standard error
// within 1.034 / sqrt(k). The mean is held to 3 rather than 2, as the MinHash
// gate is: the cells are deterministic, and at 2 a change of keys or seeds
// would fail on chance rather than bias.
//
// Bound coverage is pooled over every cell rather than held per cell. Over
// 1,500 to 8,000 trials the bounds covered about 70%, 95.7% and 99.8% at 1, 2
// and 3 sd, but at 200 trials one cell's 3-sd coverage is 99.7% give or take
// 0.4%, so a per-cell 99% fails sound bounds by chance. Pooled, it is about
// 0.1%, and one cell whose bounds broke outright still costs the pool 6%.
//
// Sets stay small. Error follows n / k, and every cell is several times past
// the largest k: counts reach 4 * 10^4 keys (10k), each set of a pair 2 * 10^4
// (5k). At 10^5 and 10^6 the verdicts were the same, but under coverage on a
// CI runner a 10^5 count cell took 20 s and a 10^5 pair cell up to 44 s,
// against a 30 s test timeout.
//
// Trials vary the seed over fixed keys. Keys are 12-byte buffers (cell, part,
// index) written into one reused array; they only need to be distinct.
const key = new Uint8Array(12);
const keyView = new DataView(key.buffer);

function fill(
  sketch: ThetaSketch,
  cell: number,
  part: number,
  n: number,
): void {
  keyView.setUint32(0, cell, true);
  keyView.setUint32(4, part, true);
  for (let i = 0; i < n; i++) {
    keyView.setUint32(8, i, true);
    sketch.add(key);
  }
}

// Every cell adds its trials' bound hits here, and the last test asserts on
// the pool. Tests in a file run in order, so it is complete by then.
const covered = [0, 0, 0];
let trials = 0;

// Asserts the mean of `sketches`' estimates is within 3 standard errors of
// the mean of `truth`, tallies their bounds, and returns the relative
// standard error of a single estimate.
function checkCell(sketches: readonly ThetaSketch[], truth: number): number {
  const estimates = sketches.map((s) => s.count());
  const mean = estimates.reduce((a, b) => a + b, 0) / estimates.length;
  const sd = Math.sqrt(
    estimates.reduce((a, b) => a + (b - mean) ** 2, 0) / (estimates.length - 1),
  );
  expect(Math.abs(mean - truth)).toBeLessThanOrEqual(
    (3 * sd) / Math.sqrt(estimates.length),
  );
  for (const sketch of sketches) {
    SDS.forEach((level, i) => {
      if (
        sketch.lowerBound(level) <= truth &&
        truth <= sketch.upperBound(level)
      ) {
        covered[i] = (covered[i] ?? 0) + 1;
      }
    });
    trials++;
  }
  return (
    Math.sqrt(
      estimates.reduce((a, b) => a + (b - truth) ** 2, 0) /
        (estimates.length - 1),
    ) / truth
  );
}

test.each<[number, number]>([
  [256, 10_000],
  [256, 40_000],
  [4096, 10_000],
  [4096, 40_000],
])(
  "a count at k %i of %i keys is unbiased and within 1.1 / sqrt(k)",
  (k, n) => {
    const sketches = Array.from({ length: TRIALS }, (_, seed) => {
      const sketch = new ThetaSketch({ k, seed });
      fill(sketch, n, 0, n);
      return sketch;
    });

    expect(checkCell(sketches, n)).toBeLessThanOrEqual(1.1 / Math.sqrt(k));
  },
);

// Two sets of 2 * 10^4 keys sharing a fraction of them. Each side is its own keys unioned with the shared ones, which
// equals adding them all, so the shared part is hashed once per trial.
test.each<[number, number]>([
  [256, 0.01],
  [256, 0.1],
  [256, 0.5],
  [4096, 0.01],
  [4096, 0.1],
  [4096, 0.5],
])(
  "at k %i and overlap %f, intersection and difference are unbiased",
  (k, fraction) => {
    const n = 20_000;
    const shared = Math.round(fraction * n);
    const cell = k * 100 + Math.round(fraction * 100);
    const both: ThetaSketch[] = [];
    const onlyA: ThetaSketch[] = [];
    for (let seed = 0; seed < TRIALS; seed++) {
      const common = new ThetaSketch({ k, seed });
      const a = new ThetaSketch({ k, seed });
      const b = new ThetaSketch({ k, seed });
      fill(common, cell, 0, shared);
      fill(a, cell, 1, n - shared);
      fill(b, cell, 2, n - shared);
      const setA = a.union(common);
      const setB = b.union(common);
      both.push(setA.intersect(setB));
      onlyA.push(setA.difference(setB));
    }

    checkCell(both, shared);
    checkCell(onlyA, n - shared);
  },
);

test("bounds cover the truth at 1, 2 and 3 sd, pooled", () => {
  expect(trials).toBeGreaterThan(0);
  const rates = covered.map((c) => c / trials);
  expect(rates[0]).toBeGreaterThanOrEqual(0.63);
  expect(rates[1]).toBeGreaterThanOrEqual(0.93);
  expect(rates[2]).toBeGreaterThanOrEqual(0.99);
});
