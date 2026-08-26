import { expect, test } from "vitest";

import { measureBytesPerOp } from "../../bench/harness.js";
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

test("an empty sketch counts exactly zero", () => {
  for (const p of [4, 14, 18]) {
    expect(new HyperLogLog({ p }).count()).toBe(0);
  }
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

// add() reuses one Hash128 struct and writes into preallocated registers, so a
// steady-state call should allocate nothing. Keys are pre-generated and cycled
// so the loop measures add() rather than string building.
test("add allocates nothing in steady state", () => {
  const sketch = new HyperLogLog({ p: 14 });
  const keys: string[] = [];
  for (let i = 0; i < 4096; i++) keys.push(`alloc:${String(i)}`);

  let at = 0;
  const bytesPerOp = measureBytesPerOp(() => {
    at = (at + 1) & 4095;
    sketch.add(keys[at] ?? "");
  }, 50_000);

  expect(bytesPerOp).toBeLessThan(16);
});
