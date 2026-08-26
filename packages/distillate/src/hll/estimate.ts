// Ertl's improved raw estimator, from "New cardinality estimation algorithms
// for HyperLogLog sketches" (Otmar Ertl, 2017). It replaces HyperLogLog++'s
// empirical bias tables: accurate across the whole cardinality range, so there
// is no linear-counting crossover and no vendored constants. Redis 5.0+ and
// Apache DataSketches use the same estimator.

// alpha_inf = 1 / (2 * ln 2), the large-m limit of the classic alpha_m.
const ALPHA_INF = 0.5 / Math.LN2;

/**
 * `sigma(x) = x + sum_{k>=1} 2^(k-1) * x^(2^k)`, evaluated by squaring until
 * the sum stops moving. Diverges at `x = 1`, which is the all-registers-zero
 * case and is what makes an empty sketch estimate exactly zero.
 */
export function sigma(x: number): number {
  if (x === 1) return Infinity;
  let y = 1;
  let z = x;
  let previous: number;
  do {
    x *= x;
    previous = z;
    z += x * y;
    y += y;
  } while (z !== previous);
  return z;
}

/**
 * `tau`, the counterpart series for the saturated end of the register range,
 * evaluated by repeated square roots until the sum stops moving.
 */
export function tau(x: number): number {
  if (x === 0 || x === 1) return 0;
  let y = 1;
  let z = 1 - x;
  let previous: number;
  do {
    x = Math.sqrt(x);
    previous = z;
    y *= 0.5;
    const gap = 1 - x;
    z -= gap * gap * y;
  } while (z !== previous);
  return z / 3;
}

/**
 * Estimates distinct cardinality from a register histogram, where `hist[k]`
 * counts registers holding `k` over `k` in `[0, q + 1]` and `q = 64 - p`.
 */
export function estimate(hist: Int32Array, p: number): number {
  const m = 2 ** p;
  const q = 64 - p;

  let z = m * tau((m - (hist[q + 1] ?? 0)) / m);
  for (let k = q; k >= 1; k--) {
    z = 0.5 * (z + (hist[k] ?? 0));
  }
  z += m * sigma((hist[0] ?? 0) / m);

  return (ALPHA_INF * m * m) / z;
}
