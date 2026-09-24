import { assertProbability, ParamError } from "../core/params.js";

/** Top-K geometry: the `TopKParams` fields a sizing solve determines. */
export interface TopKSizing {
  /** Slots in the counter map, a power of two. */
  capacity: number;
}

/** Smallest and largest counter map a sketch may use. */
export const TOPK_MIN_CAPACITY = 4;
export const TOPK_MAX_CAPACITY: number = 2 ** 24;

/**
 * Smallest power-of-two capacity whose load limit `0.75 * capacity` keeps the
 * purge offset within `epsilon` of the total recorded. Throws
 * {@link ParamError} when even `TOPK_MAX_CAPACITY` cannot.
 *
 * The bound is a function of capacity, not of k, which is why `top(k)` takes k
 * per call instead of the sketch being built for one.
 */
export function topKSizing(epsilon: number): TopKSizing {
  assertProbability(epsilon, "epsilon");
  const minSlots = Math.ceil(1 / (0.75 * epsilon));
  const capacity = 2 ** Math.ceil(Math.log2(minSlots));
  if (capacity > TOPK_MAX_CAPACITY) {
    throw new ParamError(
      `epsilon ${String(epsilon)} needs capacity ${String(capacity)}, above the maximum ${String(TOPK_MAX_CAPACITY)}`,
    );
  }
  return { capacity: Math.max(TOPK_MIN_CAPACITY, capacity) };
}
