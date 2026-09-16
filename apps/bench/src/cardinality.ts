import { HyperLogLog as IncumbentHll } from "bloom-filters";
import { HyperLogLog } from "distillate/hll";

import { hitMissPools } from "./harness.js";

export type SketchFormat = "binary" | "json";

export interface CountableSketch {
  add(key: string): void;
  count(): number;
  registers: number;
  bytes(): number;
}

export interface CardinalityAdapter {
  name: string;
  format: SketchFormat;
  create(p: number): CountableSketch;
}

export const distillateHllAdapter: CardinalityAdapter = {
  name: "distillate/hll",
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
        bytes: sketch.bytes(),
        format: adapter.format,
      });
    }
  }
  return rows;
}
