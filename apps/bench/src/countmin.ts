import { CountMinSketch as IncumbentCountMin } from "bloom-filters";
import { CountMinSketch } from "distillate/countmin";

/** The geometry a sketch actually holds, read back from the library. */
export interface CountMinSettings {
  width: number;
  depth: number;
}

export interface CountingSketch {
  add(key: string, count?: number): void;
  count(key: string): number;
  /** Bytes the sketch serializes to, each library in its own format. */
  bytes(): number;
  settings: CountMinSettings;
}

export interface CountMinAdapter {
  name: string;
  create(epsilon: number, delta: number): CountingSketch;
}

/** The target both sketches are built at. */
export const COUNTMIN_EPSILON = 0.001;
export const COUNTMIN_DELTA = 0.001;

export const distillateCountMinAdapter: CountMinAdapter = {
  name: "distillate/countmin",
  create(epsilon, delta) {
    const s = CountMinSketch.create(epsilon, delta);
    return {
      add: (key, count) => {
        s.add(key, count);
      },
      count: (key) => s.count(key),
      bytes: () => s.toBytes().length,
      settings: { width: s.width, depth: s.depth },
    };
  },
};

/**
 * Passing `delta` to an argument named `accuracy` is deliberate, and is what
 * matches the geometries.
 *
 * `bloom-filters` sizes rows as `ceil(ln(1 / accuracy))`, a formula that wants
 * the failure probability, from a parameter its documentation calls "the
 * probability of accuracy". The comment directly above that line in its source
 * even reads `rows = Math.ceil(Math.log(1 / delta))`.
 *
 * Measured: `create(0.001)` and `create(0.001, 0.999)` both give 2719 columns
 * by **one** row, where taking the minimum across rows buys nothing.
 * `create(0.001, 0.001)` gives the seven rows the target calls for.
 *
 * So the comparison below gives it seven rows rather than one, and the section
 * in RESULTS.md says what its documented call produces instead.
 */
export const incumbentCountMinAdapter: CountMinAdapter = {
  name: "bloom-filters",
  create(epsilon, delta) {
    const s = IncumbentCountMin.create(epsilon, delta);
    return {
      add: (key, count) => {
        s.update(key, count ?? 1);
      },
      count: (key) => s.count(key),
      // It has no binary form; JSON is what it persists as, as in the
      // cardinality section.
      bytes: () => JSON.stringify(s.saveAsJSON()).length,
      settings: { width: s.columns, depth: s.rows },
    };
  },
};

export const countMinAdapters: CountMinAdapter[] = [
  distillateCountMinAdapter,
  incumbentCountMinAdapter,
];
