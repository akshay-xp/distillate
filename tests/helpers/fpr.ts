import fc from "fast-check";

import type { BytesLike } from "../../src/core/bytes.js";

export interface Membership {
  add(key: BytesLike): void;
  has(key: BytesLike): boolean;
}

/** Deterministic key sample for a given seed. */
export function sampleStrings(seed: number, count: number): string[] {
  return fc.sample(fc.string(), { seed, numRuns: count });
}

/** Observed false-positive rate: fraction of `absent` keys the target reports present. */
export function measureFpr(
  target: Membership,
  present: readonly string[],
  absent: readonly string[],
): number {
  for (const key of present) target.add(key);
  let hits = 0;
  for (const key of absent) if (target.has(key)) hits++;
  return hits / absent.length;
}
