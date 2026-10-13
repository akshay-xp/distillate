import { expect, test } from "vitest";

import { MinHash } from "../../src/minhash/minhash.js";
import { classicJaccard, classicSignature } from "../helpers/minhash-oracle.js";

const K = 128;
const PAIRS = 200;
// Worst-case standard error, at J = 0.5.
const BOUND = 0.5 / Math.sqrt(K);

// Measured when the gate was written (200 pairs, k 128): from n 1000 up, OPH
// sits within 1.2x the bound and matches the classic oracle. Below k it cannot:
// a 20-item union fills at most 20 of 128 slots and densification copies the
// rest, so at n 20, J 0.5 the spread is 0.056 against classic's 0.044 (1.28x).
// That is the price of O(1) updates, so sets below k get their own ceiling.
//
// The mean is held to 3 standard errors of the mean rather than 2: the gate is
// deterministic over nine cells, and n 1000, J 0.9 sits at -2.3 with the oracle
// right on the truth there, which is chance, not bias.
//
// The oracle hashes every item k times, so it runs up to n 1000 only.
const cells: [number, number][] = [20, 1000, 100_000].flatMap((n) =>
  [0.1, 0.5, 0.9].map((j): [number, number] => [n, j]),
);

// A pair whose union has n items: round(J * n) shared, the rest split evenly.
function pair(tag: string, n: number, j: number): [string[], string[], number] {
  const shared = Math.round(j * n);
  const own = Math.floor((n - shared) / 2);
  const items = (part: string, count: number): string[] =>
    Array.from({ length: count }, (_, i) => `${tag}:${part}:${String(i)}`);
  const common = items("s", shared);
  return [
    [...common, ...items("a", own)],
    [...common, ...items("b", own)],
    shared / (shared + 2 * own),
  ];
}

function sketchOf(items: readonly string[]): MinHash {
  const sketch = new MinHash({ k: K });
  for (const item of items) sketch.add(item);
  return sketch;
}

function spread(xs: readonly number[]): { mean: number; sd: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance =
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

test.each(cells)("n %i, J %f", (n, j) => {
  const withOracle = n <= 1000;
  const oph: number[] = [];
  const classic: number[] = [];
  let truth = j;
  for (let p = 0; p < PAIRS; p++) {
    const [a, b, exact] = pair(`${String(n)}-${String(j)}-${String(p)}`, n, j);
    truth = exact;
    oph.push(sketchOf(a).jaccard(sketchOf(b)));
    if (withOracle) {
      classic.push(
        classicJaccard(classicSignature(a, K), classicSignature(b, K)),
      );
    }
  }

  const o = spread(oph);
  expect(Math.abs(o.mean - truth)).toBeLessThanOrEqual(
    (3 * o.sd) / Math.sqrt(PAIRS),
  );
  expect(o.sd).toBeLessThanOrEqual((n < K ? 1.4 : 1.2) * BOUND);

  if (!withOracle) return;
  const c = spread(classic);
  expect(Math.abs(c.mean - truth)).toBeLessThanOrEqual(
    (3 * c.sd) / Math.sqrt(PAIRS),
  );
  expect(c.sd).toBeLessThanOrEqual(1.2 * BOUND);
  expect(Math.abs(o.mean - c.mean)).toBeLessThanOrEqual(
    (3 * Math.sqrt(o.sd ** 2 + c.sd ** 2)) / Math.sqrt(PAIRS),
  );
});
