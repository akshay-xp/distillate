import { expect, test } from "vitest";

import { ALLOCATION_LIMIT, measureAllocation } from "../../bench/harness.js";
import { TopK } from "../../src/topk/topk.js";

// Alone in its file and in the single-worker project for the same reasons as
// tests/hll/allocation.test.ts.
//
// What these caught before they passed: count and a held key's add boxed the
// two SipHash key words and the hash's uint32 return on every call, about 40
// bytes/op. They run 5M calls because at 600k count read 0 collections on that
// code: V8 grows the young generation as the window runs, so a small window can
// hold all of the garbage.

const keys: string[] = [];
for (let i = 0; i < 65_536; i++) keys.push(`alloc:${String(i)}`);

const held = (): TopK => {
  const sketch = TopK.create(0.001);
  for (let i = 0; i < 2048; i++) sketch.add(keys[i] ?? "");
  return sketch;
};

test("count allocates nothing in steady state", async () => {
  const sketch = held();
  let at = 0;
  let sink = 0;
  const { collections, bytesPerCall } = await measureAllocation(() => {
    at = (at + 1) & 2047;
    sink += sketch.count(keys[at] ?? "");
  }, 5_000_000);
  expect(sink).toBeGreaterThan(0);
  expect(collections).toBe(0);
  expect(bytesPerCall).toBeLessThan(ALLOCATION_LIMIT);
});

test("add of a held key allocates nothing in steady state", async () => {
  const sketch = held();
  let at = 0;
  const { collections, bytesPerCall } = await measureAllocation(() => {
    at = (at + 1) & 2047;
    sketch.add(keys[at] ?? "");
  }, 5_000_000);
  expect(collections).toBe(0);
  expect(bytesPerCall).toBeLessThan(ALLOCATION_LIMIT);
});

// At capacity every few hundred new keys purge, so this window covers
// thousands of purges. What it caught: each purge sliced every survivor into a
// new array and sorted a copy of the counts, and each new key took a subarray
// view into the arena (about 540 bytes/op).
test("a stream of new keys allocates nothing once the sketch is full", async () => {
  const sketch = TopK.create(0.01);
  for (const key of keys) sketch.add(key);
  let at = 0;
  const { collections, bytesPerCall } = await measureAllocation(() => {
    at = (at + 1) & 65_535;
    sketch.add(keys[at] ?? "");
  }, 600_000);
  expect(collections).toBe(0);
  expect(bytesPerCall).toBeLessThan(ALLOCATION_LIMIT);
});
