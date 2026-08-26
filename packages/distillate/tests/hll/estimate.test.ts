import { expect, test } from "vitest";

import { estimate, sigma, tau } from "../../src/hll/estimate.js";

// Histogram of register values for precision p: C[k] is how many registers
// hold k, over k in [0, q + 1] where q = 64 - p.
const histogram = (p: number): Int32Array => new Int32Array(64 - p + 2);

test("sigma pins its boundary values", () => {
  expect(sigma(1)).toBe(Infinity);
  expect(sigma(0)).toBe(0);
  expect(Number.isFinite(sigma(0.5))).toBe(true);
});

test("tau pins its boundary values", () => {
  expect(tau(0)).toBe(0);
  expect(tau(1)).toBe(0);
  expect(Number.isFinite(tau(0.5))).toBe(true);
});

test("an empty sketch estimates exactly zero", () => {
  const p = 14;
  const hist = histogram(p);
  hist[0] = 2 ** p;
  expect(estimate(hist, p)).toBe(0);
});

test("a fully saturated sketch estimates Infinity", () => {
  const p = 14;
  const q = 64 - p;
  const hist = histogram(p);
  hist[q + 1] = 2 ** p;
  expect(estimate(hist, p)).toBe(Infinity);
});

test("one occupied register estimates a small positive number", () => {
  const p = 14;
  const m = 2 ** p;
  const hist = histogram(p);
  hist[0] = m - 1;
  hist[1] = 1;

  const e = estimate(hist, p);
  expect(Number.isFinite(e)).toBe(true);
  expect(e).toBeGreaterThan(0);
  expect(e).toBeLessThan(10);
});

// Independent oracle: when almost every register is still zero, cardinality is
// known accurately by linear counting, m * ln(m / zeros). Agreeing with a
// different estimator catches a subtly wrong series that self-consistent tests
// would not.
test("the estimate tracks linear counting while registers are mostly empty", () => {
  const p = 14;
  const m = 2 ** p;
  const q = 64 - p;
  for (const occupied of [1, 2, 5, 10, 100]) {
    const hist = new Int32Array(q + 2);
    hist[0] = m - occupied;
    hist[1] = occupied;
    const linearCounting = m * Math.log(m / (m - occupied));
    expect(estimate(hist, p) / linearCounting).toBeCloseTo(1, 4);
  }
});

test("the estimate grows as registers fill", () => {
  const p = 14;
  const m = 2 ** p;
  let previous = 0;
  for (const occupied of [1, 10, 100, 1000, 8000]) {
    const hist = histogram(p);
    hist[0] = m - occupied;
    hist[1] = occupied;
    const e = estimate(hist, p);
    expect(e).toBeGreaterThan(previous);
    previous = e;
  }
});
