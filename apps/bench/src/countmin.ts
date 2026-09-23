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

// xorshift32, so a surprising row reproduces exactly.
function rng(seed: number): () => number {
  let x = seed | 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

/**
 * `events` keys drawn from a Zipf distribution over `distinct` keys, rank `i`
 * appearing with probability proportional to `1 / (i + 1)`.
 *
 * This is the shape a frequency sketch exists for. A uniform stream spreads
 * counts evenly and hides the collisions between one heavy key and the many
 * light keys sharing its column, which is exactly where the estimate is tested.
 *
 * `packages/distillate` has its own copy in `tests/helpers/frequency.ts`. That
 * one is test-only code in another package and is not published, so it cannot
 * be imported here.
 */
export function zipfStream(
  seed: number,
  distinct: number,
  events: number,
): string[] {
  const cdf = new Float64Array(distinct);
  let total = 0;
  for (let i = 0; i < distinct; i++) {
    total += 1 / (i + 1);
    cdf[i] = total;
  }

  const next = rng(seed);
  const out = new Array<string>(events);
  for (let e = 0; e < events; e++) {
    const target = next() * total;
    let lo = 0;
    let hi = distinct - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((cdf[mid] ?? 0) < target) lo = mid + 1;
      else hi = mid;
    }
    out[e] = `key:${String(lo)}`;
  }
  return out;
}

/** Events per run, a thousand to ten million, the same reach as every structure. */
export const COUNTMIN_KEY_COUNTS = [
  1_000, 10_000, 100_000, 1_000_000, 10_000_000,
];

/** Distinct keys the stream draws from, so collisions are the measured effect. */
const DISTINCT = 10_000;

export interface CountMinRow {
  name: string;
  events: number;
  width: number;
  depth: number;
  bytes: number;
  /** Mean overestimate across distinct keys. */
  meanOverestimate: number;
  /** Largest overestimate seen. */
  maxOverestimate: number;
  /** Share of keys whose estimate exceeded `epsilon * events`. */
  overBoundShare: number;
  /** Answers below the true count. Must be zero for both libraries. */
  underestimates: number;
  addOpsPerSec: number;
  countOpsPerSec: number;
}

const rate = (n: number, ms: number): number => n / (ms / 1000);

export function countMinRows(
  eventCounts: number[],
  adapters: CountMinAdapter[] = countMinAdapters,
): CountMinRow[] {
  const rows: CountMinRow[] = [];
  for (const events of eventCounts) {
    // One stream per event count, shared by both adapters, so the accuracy
    // columns compare answers to the same keys.
    const stream = zipfStream(17, DISTINCT, events);
    const truth = new Map<string, number>();
    for (const key of stream) truth.set(key, (truth.get(key) ?? 0) + 1);
    const keys = [...truth.keys()];
    const bound = COUNTMIN_EPSILON * events;

    for (const adapter of adapters) {
      const s = adapter.create(COUNTMIN_EPSILON, COUNTMIN_DELTA);

      let started = performance.now();
      for (const key of stream) s.add(key);
      const addMs = performance.now() - started;

      started = performance.now();
      for (const key of keys) s.count(key);
      const countMs = performance.now() - started;

      let sum = 0;
      let max = 0;
      let overBound = 0;
      let underestimates = 0;
      for (const [key, actual] of truth) {
        const over = s.count(key) - actual;
        if (over < 0) {
          underestimates++;
          continue;
        }
        sum += over;
        if (over > max) max = over;
        if (over > bound) overBound++;
      }

      rows.push({
        name: adapter.name,
        events,
        width: s.settings.width,
        depth: s.settings.depth,
        bytes: s.bytes(),
        meanOverestimate: sum / truth.size,
        maxOverestimate: max,
        overBoundShare: overBound / truth.size,
        underestimates,
        addOpsPerSec: rate(events, addMs),
        countOpsPerSec: rate(keys.length, countMs),
      });
    }
  }
  return rows;
}
