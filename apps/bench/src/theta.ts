import { HyperLogLog } from "distillate/hll";
import { ThetaSketch } from "distillate/theta";

import { median } from "./keylength.js";

/** One trial over a pair of sets: what it cost and what it estimated. */
export interface SetCountTrial {
  /** Building both sides. */
  buildMs: number;
  /** One union, one intersection and one difference, counted. */
  setOpsMs: number;
  intersection: number;
  /** Keys in the first set and not the second. */
  difference: number;
  /** One side's serialized size; null where there is no serialized form. */
  bytes: number | null;
}

export interface SetCountAdapter {
  name: string;
  /** Builds both sides under `seed` and estimates their overlap. */
  run(a: readonly string[], b: readonly string[], seed: number): SetCountTrial;
}

// The default k: about 1.6% relative error, a frame of at most 32 KiB.
export const THETA_K = 4096;
// HLL's frame at p 16 is about 49 KB, against Theta's 33 KB at k 4096, so the
// comparison never leans on Theta holding more.
export const THETA_HLL_P = 16;

export const thetaAdapter: SetCountAdapter = {
  name: "distillate/theta",
  run(a, b, seed) {
    let started = performance.now();
    const sa = new ThetaSketch({ k: THETA_K, seed });
    for (const key of a) sa.add(key);
    const sb = new ThetaSketch({ k: THETA_K, seed });
    for (const key of b) sb.add(key);
    const buildMs = performance.now() - started;

    started = performance.now();
    sa.union(sb).count();
    const intersection = sa.intersect(sb).count();
    const difference = sa.difference(sb).count();
    const setOpsMs = performance.now() - started;
    return {
      buildMs,
      setOpsMs,
      intersection,
      difference,
      bytes: sa.toBytes().length,
    };
  },
};

/**
 * HyperLogLog unions only, so the overlap comes by inclusion-exclusion from
 * three counts: `|A| + |B| - |A ∪ B|`, and `|A ∪ B| - |B|` for the difference.
 */
export const hllAdapter: SetCountAdapter = {
  name: "distillate/hll",
  run(a, b, seed) {
    let started = performance.now();
    const sa = new HyperLogLog({ p: THETA_HLL_P, seed });
    for (const key of a) sa.add(key);
    const sb = new HyperLogLog({ p: THETA_HLL_P, seed });
    for (const key of b) sb.add(key);
    const buildMs = performance.now() - started;

    started = performance.now();
    const union = sa.union(sb).count();
    const countB = sb.count();
    const intersection = sa.count() + countB - union;
    const difference = union - countB;
    const setOpsMs = performance.now() - started;
    return {
      buildMs,
      setOpsMs,
      intersection,
      difference,
      bytes: sa.toBytes().length,
    };
  },
};

/** The exact answer, holding every key. */
export const exactAdapter: SetCountAdapter = {
  name: "Set",
  run(a, b) {
    let started = performance.now();
    const sa = new Set(a);
    const sb = new Set(b);
    const buildMs = performance.now() - started;

    started = performance.now();
    const union = new Set(sa);
    for (const key of sb) union.add(key);
    let intersection = 0;
    for (const key of sa) if (sb.has(key)) intersection++;
    const difference = sa.size - intersection;
    const setOpsMs = performance.now() - started;
    return { buildMs, setOpsMs, intersection, difference, bytes: null };
  },
};

export const setCountAdapters: SetCountAdapter[] = [
  thetaAdapter,
  hllAdapter,
  exactAdapter,
];

/** Fraction of each set the other shares. */
export const THETA_OVERLAPS = [0.01, 0.1, 0.5];
export const THETA_SET_SIZE = 1_000_000;
// One run of a sampled estimate says little, so errors are averaged over seeds.
export const THETA_SEEDS = 10;

export interface ThetaRow {
  name: string;
  overlap: number;
  /** Keys added over the time spent building, across every seed. */
  addOpsPerSec: number;
  /** Median over seeds. */
  setOpsMs: number;
  /** Mean absolute relative error over seeds. */
  intersectionError: number;
  differenceError: number;
  bytes: number | null;
}

const keysOf = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

export function thetaRows(
  n: number,
  overlaps: number[],
  seeds: number,
  adapters: SetCountAdapter[] = setCountAdapters,
): ThetaRow[] {
  const rows: ThetaRow[] = [];
  for (const overlap of overlaps) {
    // Each set holds n keys, `shared` of them in both. Built once and shared
    // by every library.
    const shared = Math.round(overlap * n);
    const both = keysOf("s", shared);
    const a = [...both, ...keysOf("a", n - shared)];
    const b = [...both, ...keysOf("b", n - shared)];

    for (const adapter of adapters) {
      let buildMs = 0;
      let intersectionError = 0;
      let differenceError = 0;
      const setOpsMs: number[] = [];
      let bytes: number | null = null;
      for (let seed = 0; seed < seeds; seed++) {
        const trial = adapter.run(a, b, seed);
        buildMs += trial.buildMs;
        setOpsMs.push(trial.setOpsMs);
        intersectionError += Math.abs(trial.intersection - shared) / shared;
        differenceError +=
          Math.abs(trial.difference - (n - shared)) / (n - shared);
        bytes = trial.bytes;
      }
      rows.push({
        name: adapter.name,
        overlap,
        addOpsPerSec: (2 * n * seeds) / (buildMs / 1000),
        setOpsMs: median(setOpsMs),
        intersectionError: intersectionError / seeds,
        differenceError: differenceError / seeds,
        bytes,
      });
    }
  }
  return rows;
}
