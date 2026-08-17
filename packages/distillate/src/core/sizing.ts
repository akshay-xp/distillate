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
