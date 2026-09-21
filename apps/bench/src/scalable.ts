import { ScalableBloomFilter as IncumbentScalable } from "bloom-filters";
import { ScalableBloomFilter } from "distillate/scalable";

import { TARGET_FPR } from "./adapters.js";
import { hitKeys } from "./harness.js";

/** The settings a filter actually holds, read back from the library. */
export interface ScalableSettings {
  initialSize: number;
  errorRate: number;
  growth: number;
  tightening: number;
}

export interface GrowingFilter {
  add(key: string): void;
  has(key: string): boolean;
  stages(): number;
  /** Bits allocated across every stage. */
  bits(): number;
  settings: ScalableSettings;
}

export interface ScalableAdapter {
  name: string;
  /** Largest key count worth measuring; past it a row projects instead. */
  maxKeys?: number;
  create(initial: number, errorRate: number): GrowingFilter;
}

/** Target false-positive rate both filters are built for. */
export const SCALABLE_ERROR_RATE = TARGET_FPR;

/** Keys the first stage is built for, in both libraries. */
export const SCALABLE_INITIAL = 1000;

// The incumbent's default ratio, and its growth is fixed at 2, so both filters
// run at the incumbent's own defaults rather than distillate's.
export const SCALABLE_RATIO = 0.5;
const GROWTH = 2;

export const distillateScalableAdapter: ScalableAdapter = {
  name: "distillate/scalable",
  create(initial, errorRate) {
    const f = ScalableBloomFilter.create(initial, errorRate, {
      growth: GROWTH,
      tightening: SCALABLE_RATIO,
    });
    return {
      add: (key) => {
        f.add(key);
      },
      has: (key) => f.has(key),
      stages: () => f.stages,
      bits: () => f.m,
      settings: {
        initialSize: f.capacity,
        errorRate: f.epsilon,
        growth: f.growth,
        tightening: f.tightening,
      },
    };
  },
};

export const incumbentScalableAdapter: ScalableAdapter = {
  name: "bloom-filters",
  // Every add recounts the newest stage's set bits (_currentload), so its
  // build is quadratic: 28 s at 100k projects to hours at 1M and days at 10M.
  maxKeys: 100_000,
  create(initial, errorRate) {
    const f = IncumbentScalable.create(initial, errorRate, SCALABLE_RATIO);
    return {
      add: (key) => {
        f.add(key);
      },
      has: (key) => f.has(key),
      stages: () => f._filters.length,
      // Each stage is k partitions of m bits.
      bits: () => f._filters.reduce((sum, s) => sum + s._nbHashes * s._m, 0),
      settings: {
        initialSize: f._initial_size,
        errorRate: f._error_rate,
        growth: IncumbentScalable._s,
        tightening: f._ratio,
      },
    };
  },
};

export const scalableAdapters: ScalableAdapter[] = [
  distillateScalableAdapter,
  incumbentScalableAdapter,
];

/** One to ten thousand times the initial size, the same 10M reach as every structure. */
export const SCALABLE_KEY_COUNTS = [
  1_000, 10_000, 100_000, 1_000_000, 10_000_000,
];

// Absent keys, disjoint from hitKeys ("0:i"), shared by every row so the FPR
// columns are measured against the same probes.
const ABSENT = Array.from({ length: 100_000 }, (_, i) => `1:${String(i)}`);

export interface MeasuredScalableRow {
  name: string;
  keys: number;
  stages: number;
  bitsPerKey: number;
  measuredFpr: number;
  addOpsPerSec: number;
  hasOpsPerSec: number;
}

/** A key count past the adapter's cap, with its build time projected. */
export interface NotRunScalableRow {
  name: string;
  keys: number;
  notRun: true;
  projectedBuildMs: number;
}

export type ScalableRow = MeasuredScalableRow | NotRunScalableRow;

export function scalableRows(
  initial: number,
  keyCounts: number[],
  adapters: ScalableAdapter[] = scalableAdapters,
): ScalableRow[] {
  const rows: ScalableRow[] = [];
  // Each adapter's largest measured build, the base a projection scales from.
  const largest = new Map<string, { keys: number; buildMs: number }>();
  for (const n of keyCounts) {
    for (const adapter of adapters) {
      if (adapter.maxKeys !== undefined && n > adapter.maxKeys) {
        const base = largest.get(adapter.name);
        rows.push({
          name: adapter.name,
          keys: n,
          notRun: true,
          projectedBuildMs: base
            ? base.buildMs * (n / base.keys) ** 2
            : Number.NaN,
        });
        continue;
      }
      const f = adapter.create(initial, SCALABLE_ERROR_RATE);

      let started = performance.now();
      for (const key of hitKeys(n)) f.add(key);
      const addMs = performance.now() - started;

      started = performance.now();
      let found = 0;
      for (const key of hitKeys(n)) if (f.has(key)) found++;
      const hasMs = performance.now() - started;
      if (found !== n) throw new Error(`${adapter.name} lost a key`);

      let falsePositives = 0;
      for (const key of ABSENT) if (f.has(key)) falsePositives++;

      largest.set(adapter.name, { keys: n, buildMs: addMs });
      rows.push({
        name: adapter.name,
        keys: n,
        stages: f.stages(),
        bitsPerKey: f.bits() / n,
        measuredFpr: falsePositives / ABSENT.length,
        addOpsPerSec: n / (addMs / 1000),
        hasOpsPerSec: n / (hasMs / 1000),
      });
    }
  }
  return rows;
}
