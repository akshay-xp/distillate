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

/** The exact value at rank `floor(q * (n - 1))`, the rank the guarantee is stated at. */
export function exactQuantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(q * (sorted.length - 1))] ?? Number.NaN;
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
