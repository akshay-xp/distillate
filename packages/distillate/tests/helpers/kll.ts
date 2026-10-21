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

// How far `value`, a sketch's answer for `q`, sits from the true q-quantile,
// as a fraction of the stream. The answer holds every index in `sorted` from
// the count below it to the count at or below it, so with duplicates the
// error is the distance from floor(q * (n - 1)) to that range, zero inside.
export function rankError(
  sorted: readonly number[],
  value: number,
  q: number,
): number {
  const n = sorted.length;
  const target = Math.floor(q * (n - 1));
  const below = countBelow(sorted, (x) => x < value);
  const atOrBelow = countBelow(sorted, (x) => x <= value);
  if (target < below) return (below - target) / n;
  if (target >= atOrBelow) return (target - atOrBelow + 1) / n;
  return 0;
}

// The length of the prefix of `sorted` that satisfies `inPrefix`.
function countBelow(
  sorted: readonly number[],
  inPrefix: (x: number) => boolean,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (inPrefix(sorted[mid] ?? 0)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
