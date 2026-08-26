import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { HyperLogLog } from "../../src/hll/hll.js";

const standardError = (p: number): number => 1.04 / Math.sqrt(2 ** p);

test("the constructor rejects a precision outside [4, 18]", () => {
  for (const p of [3, 19, 14.5, NaN, 0, -1]) {
    expect(() => new HyperLogLog({ p })).toThrow(ParamError);
  }
});

test("the constructor accepts the whole supported precision range", () => {
  for (let p = 4; p <= 18; p++) {
    expect(new HyperLogLog({ p }).p).toBe(p);
  }
});

test("seed defaults to zero and round-trips", () => {
  expect(new HyperLogLog({ p: 14 }).seed).toBe(0);
  expect(new HyperLogLog({ p: 14, seed: 7 }).seed).toBe(7);
});

test("the constructor rejects a seed outside uint32", () => {
  for (const seed of [-1, 2 ** 32, 1.5]) {
    expect(() => new HyperLogLog({ p: 14, seed })).toThrow(ParamError);
  }
});

test("standardError is the analytic 1.04 / sqrt(2 ** p)", () => {
  for (const p of [4, 10, 14, 18]) {
    expect(new HyperLogLog({ p }).standardError).toBe(standardError(p));
  }
});

test("create meets the requested relative error", () => {
  for (const e of [0.005, 0.01, 0.05, 0.1, 0.2]) {
    expect(HyperLogLog.create(e).standardError).toBeLessThanOrEqual(e);
  }
});

test("from builds a sketch over a key set in one call", () => {
  const keys = keysUpTo(100, "from");
  const sketch = HyperLogLog.from(keys, 0.01);

  expect(sketch.p).toBe(14);
  expect(sketch.count()).toBe(100);
  expect(sketch.equals(sketchOf(keys))).toBe(true);
});

test("from accepts any iterable, not just an array", () => {
  const keys = keysUpTo(100, "from");
  function* generate(): Generator<string> {
    yield* keys;
  }

  expect(HyperLogLog.from(new Set(keys), 0.01).count()).toBe(100);
  expect(HyperLogLog.from(generate(), 0.01).count()).toBe(100);
});

test("from over no keys counts zero", () => {
  expect(HyperLogLog.from([], 0.01).count()).toBe(0);
});

test("an empty sketch counts exactly zero", () => {
  for (const p of [4, 14, 18]) {
    expect(new HyperLogLog({ p }).count()).toBe(0);
  }
});

test("count reports a whole number", () => {
  const empty = new HyperLogLog({ p: 14 });
  expect(empty.count()).toBe(0);

  const one = new HyperLogLog({ p: 14 });
  one.add("alice");
  expect(Number.isInteger(one.count())).toBe(true);

  const many = new HyperLogLog({ p: 14 });
  for (let i = 0; i < 10_000; i++) many.add(`whole:${String(i)}`);
  expect(Number.isInteger(many.count())).toBe(true);
  expect(Math.abs(many.count() - 10_000) / 10_000).toBeLessThan(
    3 * many.standardError,
  );
});

test("one key counts at least one", () => {
  const sketch = new HyperLogLog({ p: 14 });
  sketch.add("alice");
  expect(sketch.count()).toBeGreaterThanOrEqual(1);
});

test("re-adding the same key does not change the count", () => {
  const sketch = new HyperLogLog({ p: 14 });
  sketch.add("alice");
  const once = sketch.count();
  for (let i = 0; i < 100; i++) sketch.add("alice");
  expect(sketch.count()).toBe(once);
});

// Below the promotion threshold the sketch holds every key it has seen at a
// far finer precision than the dense registers, so it counts rather than
// estimates. The sizes run past 200, where the dense path first stops being
// exact (it reports 301 for 300), up to just under the promotion threshold.
// Exactness assumes no 25-bit hash collision among these keys: ~0.06 expected
// at n = 2000, and deterministic under a fixed seed.
test("a small sketch counts distinct keys exactly", () => {
  for (const n of [1, 2, 10, 50, 100, 300, 500, 1000, 2000]) {
    const sketch = new HyperLogLog({ p: 14 });
    for (let i = 0; i < n; i++) sketch.add(`exact:${String(i)}`);
    expect(sketch.count()).toBe(n);

    for (let i = 0; i < n; i++) sketch.add(`exact:${String(i)}`);
    expect(sketch.count()).toBe(n);
  }
});

test("count is idempotent", () => {
  const sketch = new HyperLogLog({ p: 14 });
  for (let i = 0; i < 1000; i++) sketch.add(`key:${String(i)}`);
  expect(sketch.count()).toBe(sketch.count());
});

test("count lands within three standard errors at ten thousand keys", () => {
  const n = 10_000;
  const sketch = new HyperLogLog({ p: 14 });
  for (let i = 0; i < n; i++) sketch.add(`key:${String(i)}`);
  const error = Math.abs(sketch.count() - n) / n;
  expect(error).toBeLessThan(3 * sketch.standardError);
});

// Sweeps the cardinality range at p=14. Keys are generated once per size and
// the sketch seed is varied to obtain independent trials, so the cost is in
// hashing rather than in string building. Bounding every trial proves accuracy;
// bounding the mean *signed* error proves the estimator is unbiased, which a
// per-trial bound alone would not catch if every estimate leaned the same way.
test("count is accurate and unbiased from a hundred keys to a million", () => {
  const p = 14;
  const bound = 3 * (1.04 / Math.sqrt(2 ** p));
  const signed: number[] = [];

  for (const n of [1e2, 1e3, 1e4, 1e5, 1e6]) {
    const keys: string[] = [];
    for (let i = 0; i < n; i++) keys.push(`sweep:${String(n)}:${String(i)}`);

    for (const seed of [1, 2, 3]) {
      const sketch = new HyperLogLog({ p, seed });
      for (const key of keys) sketch.add(key);
      const relative = (sketch.count() - n) / n;
      expect(Math.abs(relative)).toBeLessThan(bound);
      signed.push(relative);
    }
  }

  const mean = signed.reduce((a, b) => a + b, 0) / signed.length;
  expect(Math.abs(mean)).toBeLessThan(0.01);
});

// The sketch switches representation somewhere in this range. Nothing about
// the reported count may betray where: a jump at the switch would mean the two
// representations disagree about the key set they hold.
test("promotion does not disturb the count", () => {
  const sketch = new HyperLogLog({ p: 14 });
  for (let i = 0; i < 3000; i++) sketch.add(`promote:${String(i)}`);

  let previous = sketch.count();
  const bound = 3 * sketch.standardError * 3200;
  for (let i = 3000; i < 3200; i++) {
    sketch.add(`promote:${String(i)}`);
    const current = sketch.count();
    expect(Math.abs(current - previous)).toBeLessThan(bound);
    previous = current;
  }
});

test("a promoted sketch agrees with one built dense throughout", () => {
  const n = 20_000;
  const grown = new HyperLogLog({ p: 14 });
  for (let i = 0; i < n; i++) grown.add(`agree:${String(i)}`);

  const error = Math.abs(grown.count() - n) / n;
  expect(error).toBeLessThan(3 * grown.standardError);
});

// Pins the surface so a representation change cannot leak into the API. Every
// entry here is a deliberate addition; promotion contributes none of them.
test("promotion adds nothing to the public surface", () => {
  expect(Object.getOwnPropertyNames(HyperLogLog.prototype).sort()).toEqual([
    "add",
    "constructor",
    "count",
    "equals",
    "p",
    "seed",
    "standardError",
    "toBytes",
    "toJSON",
    "union",
  ]);
  expect(Object.getOwnPropertyNames(HyperLogLog).sort()).toEqual([
    "create",
    "from",
    "fromBytes",
    "fromJSON",
    "length",
    "name",
    "prototype",
  ]);
});

const keysUpTo = (n: number, tag = "eq"): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < n; i++) keys.push(`${tag}:${String(i)}`);
  return keys;
};

const sketchOf = (keys: readonly string[], p = 14, seed = 0): HyperLogLog => {
  const sketch = new HyperLogLog({ p, seed });
  for (const key of keys) sketch.add(key);
  return sketch;
};

test("sketches over the same keys are equal whatever the insertion order", () => {
  for (const n of [100, 5000]) {
    const keys = keysUpTo(n);
    const forwards = sketchOf(keys);
    const backwards = sketchOf([...keys].reverse());
    expect(forwards.equals(backwards)).toBe(true);
    expect(backwards.equals(forwards)).toBe(true);
  }
});

test("empty sketches at matching params are equal", () => {
  expect(new HyperLogLog({ p: 14 }).equals(new HyperLogLog({ p: 14 }))).toBe(
    true,
  );
});

test("sketches differing in precision, seed, or contents are not equal", () => {
  const keys = keysUpTo(100);
  const base = sketchOf(keys);

  expect(base.equals(sketchOf(keys, 13))).toBe(false);
  expect(base.equals(sketchOf(keys, 14, 7))).toBe(false);
  expect(base.equals(sketchOf([...keys, "eq:extra"]))).toBe(false);
});

test("add accepts every BytesLike form, and they agree", () => {
  const text = "alice";
  const bytes = new TextEncoder().encode(text);

  const fromString = new HyperLogLog({ p: 14 });
  fromString.add(text);
  const fromBytes = new HyperLogLog({ p: 14 });
  fromBytes.add(bytes);
  const fromBuffer = new HyperLogLog({ p: 14 });
  fromBuffer.add(bytes.buffer);

  expect(fromBytes.count()).toBe(fromString.count());
  expect(fromBuffer.count()).toBe(fromString.count());
});
