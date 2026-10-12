import { expect } from "vitest";

import { rng } from "./frequency.js";

/** `n` lognormal values, the shape latencies take: a long right tail. */
export function lognormalValues(seed: number, n: number): number[] {
  const next = rng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Box-Muller; 1 - next() keeps the log argument away from 0.
    const z =
      Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
    out.push(Math.exp(z));
  }
  return out;
}

/** `n` values uniform on `[0, 1000)`: no tail, and the occasional exact 0. */
export function uniformValues(seed: number, n: number): number[] {
  const next = rng(seed);
  return Array.from({ length: n }, () => next() * 1000);
}

/**
 * `n` Pareto values with shape 1.2: a tail heavy enough that the variance is
 * infinite, the regime where relative error matters most.
 */
export function paretoValues(seed: number, n: number): number[] {
  const next = rng(seed);
  return Array.from({ length: n }, () => 1 / (1 - next()) ** (1 / 1.2));
}

/**
 * The exact values at rank `floor(q * (n - 1))` for each of `qs`, the rank the
 * guarantee is stated at. Sorts once, however many quantiles are asked for.
 */
export function exactQuantiles(
  values: readonly number[],
  qs: readonly number[],
): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return qs.map(
    (q) => sorted[Math.floor(q * (sorted.length - 1))] ?? Number.NaN,
  );
}

/**
 * The exact weighted quantile: the first value, in ascending order, whose
 * cumulative weight exceeds rank `floor(q * (W - 1))`, or the smallest when
 * that rank is negative.
 */
export function exactWeightedQuantile(
  points: readonly (readonly [value: number, weight: number])[],
  q: number,
): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, weight]) => sum + weight, 0);
  const rank = Math.floor(q * (total - 1));
  let running = 0;
  for (const [value, weight] of sorted) {
    running += weight;
    if (running > rank) return value;
  }
  return sorted.at(-1)?.[0] ?? Number.NaN;
}

/** {@link exactQuantiles} for a single `q`. */
export function exactQuantile(values: readonly number[], q: number): number {
  return exactQuantiles(values, [q])[0] ?? Number.NaN;
}

/** Asserts `got` is within `relativeAccuracy` of `want`, with float slack. */
export function expectWithin(
  got: number,
  want: number,
  relativeAccuracy: number,
): void {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(
    relativeAccuracy * Math.abs(want) * (1 + 1e-12),
  );
}
