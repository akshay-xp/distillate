import { ScalableBloomFilter as IncumbentScalable } from "bloom-filters";
import { ScalableBloomFilter } from "distillate/scalable";

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
  create(initial: number, errorRate: number): GrowingFilter;
}

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
