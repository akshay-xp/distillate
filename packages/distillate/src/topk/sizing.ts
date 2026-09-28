import { assertProbability, ParamError } from "../core/params.js";

/** Top-K geometry: the `TopKParams` fields a sizing solve determines. */
export interface TopKSizing {
  /** Slots in the counter map, a power of two. */
  capacity: number;
}

/** Smallest and largest counter map a sketch may use. */
export const TOPK_MIN_CAPACITY = 4;
export const TOPK_MAX_CAPACITY: number = 2 ** 24;

/** Live entries a map of `capacity` slots holds before it purges. */
export function topKLoadLimit(capacity: number): number {
  return Math.floor(0.75 * capacity);
}

/**
 * Entries each purge is guaranteed to take the full median from: those at or
 * above the upper median of the `loadLimit + 1` entries it sees.
 *
 * A purge adding `m` to the offset removes at least `m * width` from the
 * stored counts, which never sum past the total recorded, so the offset stays
 * at or below `total / width`. Not `total / loadLimit`: entries below the
 * median give up less than `m`, and a stream built from them reaches twice it.
 */
export function topKPurgeWidth(capacity: number): number {
  return (topKLoadLimit(capacity) + 2) >> 1;
}

/**
 * Smallest power-of-two capacity whose purge width keeps the offset within
 * `epsilon` of the total recorded. Throws {@link ParamError} when even
 * `TOPK_MAX_CAPACITY` cannot.
 *
 * The bound is a function of capacity, not of k, which is why `top(k)` takes k
 * per call instead of the sketch being built for one.
 */
export function topKSizing(epsilon: number): TopKSizing {
  assertProbability(epsilon, "epsilon");
  for (
    let capacity = TOPK_MIN_CAPACITY;
    capacity <= TOPK_MAX_CAPACITY;
    capacity *= 2
  ) {
    if (1 / topKPurgeWidth(capacity) <= epsilon) return { capacity };
  }
  throw new ParamError(
    `epsilon ${String(epsilon)} needs more than the maximum capacity ${String(TOPK_MAX_CAPACITY)}`,
  );
}
