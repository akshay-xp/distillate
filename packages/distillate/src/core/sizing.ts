export interface Sizing {
  m: number;
  k: number;
}

/** Optimal Bloom-filter sizing: `m` bits and `k` hashes for `n` items at target FPR `epsilon`. */
export function optimal(n: number, epsilon: number): Sizing {
  const m = Math.ceil((-n * Math.log(epsilon)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}
