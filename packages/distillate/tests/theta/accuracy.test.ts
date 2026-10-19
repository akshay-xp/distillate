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
    SDS.forEach((sd, i) => {
      if (sketch.lowerBound(sd) <= truth && truth <= sketch.upperBound(sd)) {
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
  [256, 1_000_000],
  [4096, 10_000],
  [4096, 1_000_000],
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

test("bounds cover the truth at 1, 2 and 3 sd, pooled", () => {
  expect(trials).toBeGreaterThan(0);
  const rates = covered.map((c) => c / trials);
  expect(rates[0]).toBeGreaterThanOrEqual(0.63);
  expect(rates[1]).toBeGreaterThanOrEqual(0.93);
  expect(rates[2]).toBeGreaterThanOrEqual(0.99);
});
