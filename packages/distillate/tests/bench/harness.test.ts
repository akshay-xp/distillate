import { getHeapSpaceStatistics } from "node:v8";

import { expect, test } from "vitest";

import { BloomFilter } from "../../src/bloom/bloom.js";
import {
  cycle,
  envBanner,
  hitMissPools,
  lookupThunk,
  measureAllocation,
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
test("measureAllocation tells an allocating loop from a flat one", async () => {
  const sink: object[] = [];
  const allocating = await measureAllocation(() => {
    sink.length = 0;
    sink.push({ a: 1, b: 2 });
  }, 1_000_000);

  let total = 0;
  const flat = await measureAllocation(() => {
    total = (total + 1) | 0;
  }, 1_000_000);

  expect(allocating.collections).toBeGreaterThan(0);
  expect(flat.collections).toBe(0);
  expect(flat.bytesPerCall).toBeLessThan(0.1);
  expect(total).toBeGreaterThanOrEqual(1_000_000);
});

// Too little garbage to fill the young generation, so usually no collection,
// but every call still allocates an object: the shape a collection count
// cannot see. Outside the allocation project the young generation is not
// pinned, so a window can still collect; that one is retried.
test("measureAllocation reports bytes a loop allocates without a collection", async () => {
  const sink: object[] = [];
  let calls = 0;
  const allocate = () => {
    if (++calls % 1000 === 0) sink.length = 0;
    sink.push({ a: calls });
  };
  let result = await measureAllocation(allocate, 5000);
  for (let attempt = 1; attempt < 5 && result.collections > 0; attempt++) {
    result = await measureAllocation(allocate, 5000);
  }

  expect(result.collections).toBe(0);
  expect(result.bytesPerCall).toBeGreaterThanOrEqual(12);
});

// A collection frees memory mid-window, so the byte reading would come out low
// or negative: a number that looks like a pass.
test("measureAllocation reads no bytes from a window that collected", async () => {
  const sink: object[] = [];
  const result = await measureAllocation(() => {
    sink.length = 0;
    sink.push({ a: 1, b: 2 });
  }, 1_000_000);

  expect(result.collections).toBeGreaterThan(0);
  expect(result.bytesPerCall).toBeNaN();
});

// What failed CI. V8 empties the young generation on a task once it is about
// 80% full, so a window could open with it most of the way there, and a clean
// window allocating the rest then collected. Here the window opens after the
// young generation is filled to 70%, and allocates half of one.
test("measureAllocation does not charge a window for what the young generation already held", async () => {
  const young = () =>
    getHeapSpaceStatistics().find((s) => s.space_name === "new_space");
  const used = (): number => young()?.space_used_size ?? 0;
  const capacity = used() + (young()?.space_available_size ?? 0);
  const sink: unknown[] = new Array<unknown>(64);
  let calls = 0;
  const allocate = (): void => {
    sink[++calls & 63] = new Array<number>(30);
  };
  // What a call costs depends on pointer compression, so it is measured; a
  // scavenge in between reads as less, and that reading is retaken.
  let perCall = 0;
  while (perCall <= 0) {
    const before = used();
    for (let i = 0; i < 1000; i++) allocate();
    perCall = (used() - before) / 1000;
  }
  while (used() < 0.7 * capacity) allocate();

  const result = await measureAllocation(
    allocate,
    Math.floor(capacity / 2 / perCall),
    0,
  );

  expect(result.collections).toBe(0);
});

// A loop allocates while V8 is still optimising it, and that is not the loop's
// steady-state cost. This is the shape that failed CI: `add` allocates one
// object per key until the hash path is inlined, and a probe that starts
// counting before then measures the warm-up rather than the code.
test("measureAllocation excludes what a loop allocates while warming", async () => {
  const sink: object[] = [];
  let calls = 0;
  const settles = await measureAllocation(() => {
    calls++;
    if (calls <= 400_000) {
      sink.length = 0;
      sink.push({ a: 1, b: 2 });
    }
  }, 1_000_000);

  expect(settles.collections).toBe(0);
  expect(calls).toBeGreaterThan(1_400_000);
});
