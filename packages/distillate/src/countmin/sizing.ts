import { assertProbability } from "../core/params.js";

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
