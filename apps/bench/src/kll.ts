import { DDSketch } from "distillate/ddsketch";
import { KllSketch } from "distillate/kll";
import { TDigest } from "tdigest";

import { rng } from "./countmin.js";
import { lognormalStream } from "./ddsketch.js";
import { median } from "./keylength.js";

export interface RankSketch {
  add(value: number): void;
  quantile(q: number): number;
  /** Bytes in the form the library would store. */
  bytes(): number;
  /** A new sketch holding this one and `other`, both left as they were. */
  union(other: RankSketch): RankSketch;
}

export interface RankAdapter {
  name: string;
  /** An empty sketch at the library's defaults; `seed` only where it takes one. */
  create(seed: number): RankSketch;
}

// Each wrapper's library sketch, so union can reach the other operand's.
const raw = new WeakMap<RankSketch, unknown>();

function wrap<S>(
  s: S,
  ops: Omit<RankSketch, "union"> & { union(other: S): RankSketch },
): RankSketch {
  const wrapped: RankSketch = {
    ...ops,
    union: (other) => ops.union(raw.get(other) as S),
  };
  raw.set(wrapped, s);
  return wrapped;
}

function kllOf(s: KllSketch): RankSketch {
  return wrap(s, {
    add: (v) => {
      s.add(v);
    },
    quantile: (q) => s.quantile(q),
    bytes: () => s.toBytes().length,
    union: (other) => kllOf(s.union(other)),
  });
}

function ddSketchOf(s: DDSketch): RankSketch {
  return wrap(s, {
    add: (v) => {
      s.add(v);
    },
    quantile: (q) => s.quantile(q),
    bytes: () => s.toBytes().length,
    union: (other) => ddSketchOf(s.union(other)),
  });
}

function tDigestOf(s: TDigest): RankSketch {
  return wrap(s, {
    add: (v) => {
      s.push(v);
    },
    quantile: (q) => s.percentile(q),
    // It has no serialization; its centroids as JSON are what a user would
    // store.
    bytes: () => JSON.stringify(s.toArray()).length,
    // It has no merge either: a fresh digest takes both sets of centroids.
    union: (other) => {
      const merged = new TDigest();
      merged.push_centroid(s.toArray());
      merged.push_centroid(other.toArray());
      merged.compress();
      return tDigestOf(merged);
    },
  });
}

function arrayOf(values: number[]): RankSketch {
  let sorted = false;
  return wrap(values, {
    add: (v) => {
      values.push(v);
      sorted = false;
    },
    quantile: (q) => {
      if (!sorted) values.sort((a, b) => a - b);
      sorted = true;
      return values[Math.floor(q * (values.length - 1))] ?? NaN;
    },
    bytes: () => 8 * values.length,
    union: (other) => arrayOf([...values, ...other]),
  });
}

export const rankAdapters: RankAdapter[] = [
  { name: "distillate/kll", create: (seed) => kllOf(new KllSketch({ seed })) },
  {
    name: "distillate/ddsketch",
    create: () => ddSketchOf(DDSketch.create(0.01)),
  },
  { name: "tdigest", create: () => tDigestOf(new TDigest()) },
  // Its centroids at this delta store about as many bytes as KLL at k 200, so
  // accuracy is also compared at matched size.
  {
    name: "tdigest (delta = 0.1)",
    create: () => tDigestOf(new TDigest(0.1)),
  },
  { name: "Array", create: () => arrayOf([]) },
];

export type Distribution = "uniform" | "lognormal" | "ascending";

export const KLL_DISTRIBUTIONS: Distribution[] = [
  "uniform",
  "lognormal",
  "ascending",
];
export const KLL_N = 1_000_000;
// One run of a randomized sketch says little, so errors are averaged over
// seeds.
export const KLL_SEEDS = 10;

/** The quantiles each error is measured at. */
export const KLL_QS = [0.5, 0.99, 0.999];

/** `n` values of `distribution`, differing by `seed`. */
export function streamOf(
  distribution: Distribution,
  seed: number,
  n: number,
): number[] {
  if (distribution === "lognormal") return lognormalStream(seed, n);
  if (distribution === "ascending") {
    return Array.from({ length: n }, (_, i) => seed + i);
  }
  const next = rng(seed);
  return Array.from({ length: n }, () => next());
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

/**
 * How far `value`, a sketch's answer for `q`, sits from the true q-quantile,
 * as a fraction of the stream: the distance from floor(q * (n - 1)) to the
 * indices `value` holds in `sorted`, zero inside them.
 */
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

export interface KllRow {
  name: string;
  distribution: Distribution;
  /** Values added over the time spent adding, across every seed. */
  addOpsPerSec: number;
  /** Median over seeds of one union of two sketches of n values. */
  mergeMs: number;
  bytes: number;
  /** Mean over seeds of the rank error at each of KLL_QS. */
  rankErrors: number[];
}

export function kllRows(
  n: number,
  distributions: Distribution[],
  seeds: number,
  adapters: RankAdapter[] = rankAdapters,
): KllRow[] {
  const rows: KllRow[] = [];
  for (const distribution of distributions) {
    const stats = adapters.map(() => ({
      addMs: 0,
      mergeMs: [] as number[],
      bytes: 0,
      errors: KLL_QS.map(() => 0),
    }));
    for (let seed = 0; seed < seeds; seed++) {
      // Built once per seed and shared by every library. rng treats seeds 0
      // and 1 alike, so streams start from 1.
      const stream = streamOf(distribution, seed + 1, n);
      const second = streamOf(distribution, seed + 1001, n);
      const sorted = [...stream].sort((a, b) => a - b);
      adapters.forEach((adapter, i) => {
        const stat = stats[i]!;
        const s = adapter.create(seed + 1);
        let started = performance.now();
        for (const v of stream) s.add(v);
        stat.addMs += performance.now() - started;

        KLL_QS.forEach((q, j) => {
          stat.errors[j]! += rankError(sorted, s.quantile(q), q);
        });
        stat.bytes = s.bytes();

        const other = adapter.create(seed + 1001);
        for (const v of second) other.add(v);
        started = performance.now();
        s.union(other);
        stat.mergeMs.push(performance.now() - started);
      });
    }
    adapters.forEach((adapter, i) => {
      const stat = stats[i]!;
      rows.push({
        name: adapter.name,
        distribution,
        addOpsPerSec: (n * seeds) / (stat.addMs / 1000),
        mergeMs: median(stat.mergeMs),
        bytes: stat.bytes,
        rankErrors: stat.errors.map((e) => e / seeds),
      });
    });
  }
  return rows;
}
