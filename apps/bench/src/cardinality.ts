import { HyperLogLog as IncumbentHll } from "bloom-filters";
import { HyperLogLog } from "distillate/hll";

import { hitMissPools } from "./harness.js";

export interface CountableSketch {
  add(key: string): void;
  count(): number;
  registers: number;
  bytes(): number;
}

export interface CardinalityAdapter {
  name: string;
  create(p: number): CountableSketch;
}

export const distillateHllAdapter: CardinalityAdapter = {
  name: "distillate/hll",
  create(p) {
    const sketch = new HyperLogLog({ p });
    return {
      add: (key) => {
        sketch.add(key);
      },
      count: () => sketch.count(),
      registers: 2 ** sketch.p,
      bytes: () => 0,
    };
  },
};

export const incumbentHllAdapter: CardinalityAdapter = {
  name: "bloom-filters",
  create(p) {
    const sketch = new IncumbentHll(2 ** p);
    return {
      add: (key) => {
        sketch.update(key);
      },
      count: () => sketch.count(),
      registers: sketch.nbRegisters,
      bytes: () => 0,
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
}

export function cardinalityRows(
  p: number,
  cardinalities: number[],
): CardinalityRow[] {
  const rows: CardinalityRow[] = [];
  for (const n of cardinalities) {
    const hit = hitMissPools(n).hit;
    for (const adapter of cardinalityAdapters) {
      const sketch = adapter.create(p);
      for (const key of hit) sketch.add(key);
      const estimate = sketch.count();
      rows.push({
        name: adapter.name,
        p,
        registers: sketch.registers,
        n,
        estimate,
        relativeError: Math.abs(estimate - n) / n,
      });
    }
  }
  return rows;
}
