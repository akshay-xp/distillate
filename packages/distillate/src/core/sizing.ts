import { assertProbability } from "./params.js";

/** Bloom filter geometry: the `BloomParams` fields a sizing solve determines. */
export interface BloomSizing {
  /** Number of bits in the filter. */
  m: number;
  /** Number of hash probes per key. */
  k: number;
}

/** Optimal Bloom-filter sizing: `m` bits and `k` hashes for `n` items at target FPR `epsilon`. */
export function bloomSizing(n: number, epsilon: number): BloomSizing {
  const m = Math.ceil((-n * Math.log(epsilon)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}

/** Count-Min geometry: the `CountMinParams` fields a sizing solve determines. */
export interface CountMinSizing {
  /** Counters per row. */
  width: number;
  /** Number of rows, one probe each. */
  depth: number;
}

/**
 * Count-Min sizing: `width` columns and `depth` rows for an estimate at most
 * `epsilon * total` above the true count, with probability `1 - delta`.
 */
export function countMinSizing(epsilon: number, delta: number): CountMinSizing {
  assertProbability(epsilon, "epsilon");
  assertProbability(delta, "delta");
  return {
    width: Math.ceil(Math.E / epsilon),
    depth: Math.ceil(Math.log(1 / delta)),
  };
}
