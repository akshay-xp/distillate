import { expect } from "vitest";

import { MinHash } from "../../src/minhash/minhash.js";
import {
  classicAdd,
  classicJaccard,
  classicSignature,
} from "./minhash-oracle.js";

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
// deterministic over nine cells, and n 1000, J 0.9 sat at -2.3 with the oracle
// right on the truth there, which is chance, not bias.
//
// The oracle hashes every item k times, so it runs up to n 1000 only.

// Items are 12-byte keys (cell, pair, part and index), written into one
// reused buffer. They only need to be distinct; long string keys spent most
// of the gate's time in UTF-8 encoding rather than in the sketch.
const SHARED = 0;
const ONLY_A = 1;
const ONLY_B = 2;
const key = new Uint8Array(12);
const keyView = new DataView(key.buffer);

function eachItem(
  cell: number,
  p: number,
  part: number,
  count: number,
  fn: (item: Uint8Array) => void,
): void {
  keyView.setUint32(0, cell, true);
  keyView.setUint32(4, p, true);
  for (let i = 0; i < count; i++) {
    keyView.setUint32(8, (part << 24) | i, true);
    fn(key);
  }
}

function spread(xs: readonly number[]): { mean: number; sd: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance =
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * Asserts the Jaccard estimate over 200 pairs whose union holds `n` items at
 * similarity `j`: unbiased and within bound, and, up to n 1000, in agreement
 * with classic MinHash.
 */
export function checkJaccardCell(n: number, j: number): void {
  const withOracle = n <= 1000;
  // A pair whose union has n items: round(J * n) shared, the rest split
  // evenly between the two sides.
  const shared = Math.round(j * n);
  const own = Math.floor((n - shared) / 2);
  const truth = shared / (shared + 2 * own);
  const cell = n * 16 + Math.round(j * 10);

  const oph: number[] = [];
  const classic: number[] = [];
  for (let p = 0; p < PAIRS; p++) {
    // The shared part is sketched once and merged into each side: union is a
    // slot-wise min, so each side ends bit-identical to adding every item.
    const common = new MinHash({ k: K });
    const onlyA = new MinHash({ k: K });
    const onlyB = new MinHash({ k: K });
    const ca = classicSignature(K);
    const cb = classicSignature(K);
    eachItem(cell, p, SHARED, shared, (item) => {
      common.add(item);
      if (withOracle) classicAdd(item, ca, cb);
    });
    eachItem(cell, p, ONLY_A, own, (item) => {
      onlyA.add(item);
      if (withOracle) classicAdd(item, ca);
    });
    eachItem(cell, p, ONLY_B, own, (item) => {
      onlyB.add(item);
      if (withOracle) classicAdd(item, cb);
    });
    oph.push(common.union(onlyA).jaccard(common.union(onlyB)));
    if (withOracle) classic.push(classicJaccard(ca, cb));
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
}
