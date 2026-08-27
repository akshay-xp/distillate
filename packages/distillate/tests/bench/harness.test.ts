import { expect, test } from "vitest";

import { BloomFilter } from "../../src/bloom/bloom.js";
import {
  cycle,
  envBanner,
  hitMissPools,
  lookupThunk,
  measureBytesPerOp,
  measureFpr,
} from "../../bench/harness.js";

test("hitMissPools returns disjoint hit and miss pools", () => {
  const { hit, miss } = hitMissPools(1000);
  expect(hit).toHaveLength(1000);
  expect(miss).toHaveLength(1000);
  expect(new Set([...hit, ...miss]).size).toBe(2000);
});

test("cycle walks the pool in order and wraps", () => {
  const next = cycle(["a", "b"]);
  expect(next()).toBe("a");
  expect(next()).toBe("b");
  expect(next()).toBe("a");
});

test("measureFpr reports the miss-set positive rate of a built filter", () => {
  const miss = hitMissPools(100).miss;
  expect(measureFpr({ has: () => true }, miss)).toBe(1);
  expect(measureFpr({ has: () => false }, miss)).toBe(0);

  const { hit, miss: absent } = hitMissPools(1000);
  const f = BloomFilter.create(1000, 0.01);
  for (const k of hit) f.add(k);
  const fpr = measureFpr(f, absent);
  expect(fpr).toBeGreaterThan(0);
  expect(fpr).toBeLessThan(0.05);
});

test("envBanner names the runtime and reports core count", () => {
  const banner = envBanner();
  expect(banner).toMatch(/(node|bun|deno) v/);
  expect(banner).toMatch(/\d+ cores/);
});

test("lookupThunk queries successive cycling keys", () => {
  const seen: string[] = [];
  const filter = {
    has(key: string) {
      seen.push(key);
      return false;
    },
  };
  const run = lookupThunk(filter, ["a", "b", "c"]);
  run();
  run();
  run();
  run();
  expect(seen).toEqual(["a", "b", "c", "a"]);
});

// The probe must separate "allocates nothing" from "allocates a small object".
// Individual rounds are noisy in both directions (a collection inside a window
// makes a reading negative), which is why the probe takes a median; measured,
// an allocating loop lands near 73 bytes/op and a non-allocating one at exactly
// 0, so the two are never in doubt.
// A cold loop allocates while V8 optimises it, and that is not the loop's
// steady-state cost. This stands in for a slow CI runner, where the warm-up
// stretches across several measurement windows: on such a machine the probe
// read 35 to 40 bytes/op for add(), which allocates nothing.
test("measureBytesPerOp ignores what a cold loop allocates while warming", () => {
  const early: object[] = [];
  let calls = 0;
  const settles = measureBytesPerOp(() => {
    calls++;
    if (calls <= 250_000) early.push({ a: 1, b: 2 });
  }, 50_000);

  expect(calls).toBeGreaterThan(250_000);
  expect(settles).toBeLessThan(16);
});

// The warm-up rule stops as soon as two consecutive windows agree, and a loop
// still warming produces agreeing windows just as readily as a settled one.
// The sink is preallocated so each window grows the heap by the same amount:
// that makes the cold readings a flat plateau rather than the lumpy ones a
// growing array gives, and a flat plateau is what defeats the rule. Measured,
// the windows here run 38.0 40.0 40.1 40.0 40.0 40.0 40.0 0.0 0.0, so warm-up
// breaks on the second pair and the median of what follows is the warming
// cost. That is the CI failure exactly: node 24 read a stable 40.006 bytes/op
// for add(), failed the build, and passed on rerun with no code change.
test("measureBytesPerOp survives a warm-up that outlasts a single measurement", () => {
  const early = new Array<object>(400_000);
  let calls = 0;
  const settles = measureBytesPerOp(() => {
    if (calls < 350_000) early[calls] = { a: 1, b: 2 };
    calls++;
  }, 50_000);

  expect(calls).toBeGreaterThan(350_000);
  expect(settles).toBeLessThan(16);
});

test("measureBytesPerOp tells an allocating loop from a non-allocating one", () => {
  const retained: object[] = [];
  const allocating = measureBytesPerOp(() => {
    retained.push({ a: 1, b: 2 });
  }, 50_000);

  let total = 0;
  const flat = measureBytesPerOp(() => {
    total += 1;
  }, 50_000);

  // At least `ops`, since the probe also warms the loop up before measuring.
  expect(total).toBeGreaterThanOrEqual(50_000);
  expect(retained.length).toBeGreaterThanOrEqual(50_000);
  expect(allocating).toBeGreaterThan(24);
  expect(flat).toBeLessThan(16);
});
