import { ParamError } from "../core/params.js";

// One-sided normal tail beyond 1, 2 and 3 standard deviations, so each
// two-sided interval matches the familiar 68.3%, 95.4% and 99.7%.
const TAILS = [0.158655, 0.02275, 0.0013499];

function tailFor(sd: number): number {
  const tail = TAILS[sd - 1];
  if (!Number.isInteger(sd) || tail === undefined) {
    throw new ParamError(`sd must be 1, 2 or 3, got ${String(sd)}`);
  }
  return tail;
}

// Chi-square quantile with nu degrees of freedom at normal deviate z, by the
// Wilson-Hilferty cube approximation.
function chi(nu: number, z: number): number {
  const a = 2 / (9 * nu);
  return nu * (1 - a + z * Math.sqrt(a)) ** 3;
}

// The retained count is binomial in the true count n at rate p. The Garwood
// interval treats it as Poisson, whose variance np overstates the binomial's
// np(1 - p); scaling the distance from r / p by sqrt(1 - p) corrects that, and
// keeps the bounds from going about 3x too wide at p near 1.
function toBinomial(bound: number, r: number, p: number): number {
  return Math.max(r, r / p + (bound - r / p) * Math.sqrt(1 - p));
}

/**
 * Lower bound on the distinct count behind `retained` hashes sampled at rate
 * `p`, at `sd` standard deviations. Never below `retained`: every retained
 * hash is a real key.
 */
export function thetaLowerBound(
  retained: number,
  p: number,
  sd: number,
): number {
  tailFor(sd);
  if (p === 1 || retained === 0) return retained;
  return toBinomial(chi(2 * retained, -sd) / (2 * p), retained, p);
}

/**
 * Upper bound on the distinct count behind `retained` hashes sampled at rate
 * `p`, at `sd` standard deviations.
 */
export function thetaUpperBound(
  retained: number,
  p: number,
  sd: number,
): number {
  const tail = tailFor(sd);
  if (p === 1) return retained;
  // Exact: the n at which seeing no hash at all is as unlikely as the tail.
  if (retained === 0) return Math.log(tail) / Math.log(1 - p);
  return toBinomial(chi(2 * retained + 2, sd) / (2 * p), retained, p);
}
