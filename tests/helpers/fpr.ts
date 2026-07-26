import type { BytesLike } from "../../src/core/bytes.js";

export interface Membership {
  add(key: BytesLike): void;
  has(key: BytesLike): boolean;
}

/**
 * Deterministic sample of `count` distinct keys for a given seed. Distinct
 * within a seed (so a filter loads to exactly `count`) and disjoint across
 * seeds (distinct seeds share no keys), which is what FPR measurement needs.
 */
export function sampleStrings(seed: number, count: number): string[] {
  const out = new Array<string>(count);
  for (let i = 0; i < count; i++) out[i] = `${String(seed)}:${String(i)}`;
  return out;
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
