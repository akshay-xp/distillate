import { type KllSketch } from "../../src/kll/kll.js";

// 0 to n - 1 in a fixed shuffled order, from a full-period LCG step.
export function shuffled(n: number): number[] {
  const values = Array.from({ length: n }, (_, i) => i);
  let state = 12345;
  for (let i = n - 1; i > 0; i--) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    const j = state % (i + 1);
    [values[i], values[j]] = [values[j] ?? 0, values[i] ?? 0];
  }
  return values;
}

// The largest |rank(quantile(q)) - q| over q = 0.01 to 0.99, against the
// exact rank of each answer in a stream whose sorted form is `sorted`.
export function worstRankError(
  sketch: KllSketch,
  sorted: readonly number[],
): number {
  let worst = 0;
  for (let i = 1; i <= 99; i++) {
    const q = i / 100;
    const value = sketch.quantile(q);
    let below = 0;
    while (below < sorted.length && (sorted[below] ?? 0) <= value) below++;
    worst = Math.max(worst, Math.abs(below / sorted.length - q));
  }
  return worst;
}
