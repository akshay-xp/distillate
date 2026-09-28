import { TopK as IncumbentTopK } from "bloom-filters";
import { TopK } from "distillate/topk";

/** One entry of a top-k answer: the key and the library's estimate of it. */
export interface TopKEntryOut {
  key: string;
  estimate: number;
}

export interface TopKSketch {
  add(key: string): void;
  top(k: number): TopKEntryOut[];
  /** Bytes the sketch serializes to, each library in its own format. */
  bytes(): number;
  /** What the sketch actually holds, read back from the library. */
  settings: Record<string, number>;
}

export interface TopKAdapter {
  name: string;
  create(epsilon: number, delta: number, k: number): TopKSketch;
}

/** The error target both sketches are built at. */
export const TOPK_EPSILON = 0.001;
export const TOPK_DELTA = 0.001;
/** The k queried from ours and given to the incumbent's constructor. */
export const TOPK_K = 100;

/**
 * Sized by error alone, so `delta` and `k` are unused here: the bound is a
 * function of capacity, and `k` is taken per query.
 */
export const distillateTopKAdapter: TopKAdapter = {
  name: "distillate/topk",
  create(epsilon) {
    const s = TopK.create(epsilon);
    const decoder = new TextDecoder();
    return {
      add: (key) => {
        s.add(key);
      },
      top: (k) =>
        s
          .top(k)
          .map((e) => ({ key: decoder.decode(e.key), estimate: e.count })),
      bytes: () => s.toBytes().length,
      settings: { capacity: s.capacity },
    };
  },
};

/**
 * Passing `delta` to an argument named `accuracy` is deliberate, as for
 * Count-Min.
 *
 * `bloom-filters`' `TopK(k, errorRate, accuracy)` hands `accuracy` straight to
 * `CountMinSketch.create`, which sizes rows as `ceil(ln(1 / accuracy))`: the
 * failure probability, from a parameter documented as the probability of
 * accuracy. Measured, `new TopK(10, 0.001)` gets 2719 columns by **one** row.
 * Passing 0.001 gives the seven rows the target calls for.
 *
 * It takes `k` at construction and keeps only that many keys, so it is given
 * the same `k` ours is queried with.
 */
export const incumbentTopKAdapter: TopKAdapter = {
  name: "bloom-filters",
  create(epsilon, delta, k) {
    const s = new IncumbentTopK(k, epsilon, delta);
    // Its geometry is not public API; the sketch is read back to confirm the
    // rows the argument choice was made for.
    const sketch = (
      s as unknown as { _sketch: { columns: number; rows: number } }
    )._sketch;
    return {
      add: (key) => {
        s.add(key);
      },
      top: (n) =>
        s
          .values()
          .slice(0, n)
          .map((v) => ({ key: v.value, estimate: v.frequency })),
      // It has no binary form; JSON is what it persists as.
      bytes: () => JSON.stringify(s.saveAsJSON()).length,
      settings: { width: sketch.columns, depth: sketch.rows, k },
    };
  },
};

export const topKAdapters: TopKAdapter[] = [
  distillateTopKAdapter,
  incumbentTopKAdapter,
];

/**
 * Precision and recall of `returned` against the true top `k` of `truth`.
 *
 * Keys tied at the k-th true count are interchangeable: every key above that
 * count must come back, and any of the tied keys may fill the places left, so
 * a correct answer scores 1 whichever tied keys it chose. With fewer distinct
 * keys than `k`, the whole key set is the answer.
 */
export function scoreTopK(
  returned: string[],
  truth: Map<string, number>,
  k: number,
): { precision: number; recall: number } {
  const counts = [...truth.values()].sort((a, b) => b - a);
  const kEff = Math.min(k, counts.length);
  if (kEff === 0 || returned.length === 0) return { precision: 0, recall: 0 };
  const kth = counts[kEff - 1] ?? 0;

  let above = 0;
  for (const count of truth.values()) if (count > kth) above++;
  let hitAbove = 0;
  let hitTied = 0;
  for (const key of returned) {
    const count = truth.get(key) ?? 0;
    if (count > kth) hitAbove++;
    else if (count === kth) hitTied++;
  }
  const matched = hitAbove + Math.min(hitTied, kEff - above);
  return { precision: matched / returned.length, recall: matched / kEff };
}
