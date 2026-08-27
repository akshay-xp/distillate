import { expect, test } from "vitest";

import { BloomFilter } from "../../src/bloom/bloom.js";
import {
  countCollections,
  cycle,
  envBanner,
  hitMissPools,
  lookupThunk,
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

// Counting collections, rather than differencing `heapUsed`, is what makes the
// two cases unambiguous. The assertion is the binary, not a magnitude: how many
// collections a given amount of garbage causes depends on how far V8 has grown
// the young generation, so the same allocating loop measures 25 collections
// alone and 5 once the tests above have grown it. What does not vary is that a
// loop allocating nothing causes none, which is structural rather than lucky:
// a collection fires when the allocating thread asks for memory, and gc entries
// are per-isolate, so a loop that never allocates cannot trigger one.
//
// The flat loop's counter is asserted too, so an implementation that returns 0
// without ever running the loop cannot pass.
test("countCollections tells an allocating loop from a flat one", async () => {
  const sink: object[] = [];
  const allocating = await countCollections(() => {
    sink.length = 0;
    sink.push({ a: 1, b: 2 });
  }, 1_000_000);

  let total = 0;
  const flat = await countCollections(() => {
    total = (total + 1) | 0;
  }, 1_000_000);

  expect(allocating).toBeGreaterThan(0);
  expect(flat).toBe(0);
  expect(total).toBeGreaterThanOrEqual(1_000_000);
});

// A loop allocates while V8 is still optimising it, and that is not the loop's
// steady-state cost. This is the shape that failed CI: `add` allocates one
// object per key until the hash path is inlined, and a probe that starts
// counting before then measures the warm-up rather than the code.
test("countCollections excludes what a loop allocates while warming", async () => {
  const sink: object[] = [];
  let calls = 0;
  const settles = await countCollections(() => {
    calls++;
    if (calls <= 400_000) {
      sink.length = 0;
      sink.push({ a: 1, b: 2 });
    }
  }, 1_000_000);

  expect(settles).toBe(0);
  expect(calls).toBeGreaterThan(1_400_000);
});
