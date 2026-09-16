import { HyperLogLog as IncumbentHll } from "bloom-filters";
import { HyperLogLog } from "distillate/hll";

import { hitKeys } from "./harness.js";

export type SketchFormat = "binary" | "json";

export interface CountableSketch {
  add(key: string): void;
  count(): number;
  registers: number;
  bytes(): number;
}

export interface CardinalityAdapter {
  name: string;
  /** Prefix for throughput rows, kept distinct from the filter benches of the same library. */
  benchLabel: string;
  format: SketchFormat;
  create(p: number): CountableSketch;
}

export const distillateHllAdapter: CardinalityAdapter = {
  name: "distillate/hll",
  benchLabel: "distillate/hll",
  format: "binary",
  create(p) {
    const sketch = new HyperLogLog({ p });
    return {
      add: (key) => {
        sketch.add(key);
      },
      count: () => sketch.count(),
      registers: 2 ** sketch.p,
      bytes: () => sketch.toBytes().length,
    };
  },
};

export const incumbentHllAdapter: CardinalityAdapter = {
  name: "bloom-filters",
  benchLabel: "bloom-filters hll",
  format: "json",
  create(p) {
    const sketch = new IncumbentHll(2 ** p);
    return {
      add: (key) => {
        sketch.update(key);
      },
      count: () => sketch.count(),
      registers: sketch.nbRegisters,
      bytes: () => JSON.stringify(sketch.saveAsJSON()).length,
    };
  },
};

export const cardinalityAdapters: CardinalityAdapter[] = [
  distillateHllAdapter,
  incumbentHllAdapter,
];

export interface CardinalityRow {
  name: string;
  p: number;
  registers: number;
  n: number;
  estimate: number;
  relativeError: number;
  bytes: number;
  format: SketchFormat;
}

export function cardinalityRows(
  p: number,
  cardinalities: number[],
): CardinalityRow[] {
  const rows: CardinalityRow[] = [];
  for (const n of cardinalities) {
    for (const adapter of cardinalityAdapters) {
      const sketch = adapter.create(p);
      for (const key of hitKeys(n)) sketch.add(key);
      const estimate = sketch.count();
      rows.push({
        name: adapter.name,
        p,
        registers: sketch.registers,
        n,
        estimate,
        relativeError: Math.abs(estimate - n) / n,
        bytes: sketch.bytes(),
        format: adapter.format,
      });
    }
  }
  return rows;
}

export const HLL_PRECISION = 14;

// Swept so both of the incumbent's regimes are visible: it is roughly 50% off
// below n of about 2.5 * m, and accurate once n is well past m.
export const HLL_CARDINALITIES = [
  1_000, 10_000, 100_000, 1_000_000, 10_000_000,
];

// The incumbent adds at about 8k ops/s, so a 100k sketch costs it 12.5 seconds.
// That is what caps the build size for the throughput benches.
export const HLL_BENCH_KEYS = 20_000;

export function cardinalityBenchLabels(): string[] {
  return cardinalityAdapters.flatMap((a) => [
    `${a.benchLabel} add`,
    `${a.benchLabel} count`,
  ]);
}
