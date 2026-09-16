import { HyperLogLog as IncumbentHll } from "bloom-filters";
import { HyperLogLog } from "distillate/hll";

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
