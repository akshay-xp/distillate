import { expect, test } from "vitest";

import { ScalableBloomFilter } from "../../src/scalable/scalable.js";

const range = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i)}`);

const filled = (keys: string[]): ScalableBloomFilter => {
  const f = ScalableBloomFilter.create(10, 0.01);
  for (const key of keys) f.add(key);
  return f;
};

const aKeys = range("a", 25); // stages of 10 and 15
const bKeys = range("b", 60); // stages of 10, 20 and 30

test("union holds every key of both inputs, over the longer chain", () => {
  const a = filled(aKeys);
  const b = filled(bKeys);
  const u = a.union(b);

  for (const key of [...aKeys, ...bKeys]) expect(u.has(key)).toBe(true);
  expect(u.stages).toBe(3);
  expect(u.capacity).toBe(10 + 20 + 40);
  // min(capacity, a + b) per stage: min(10, 20) + min(20, 35) + min(40, 30).
  expect(u.count).toBe(10 + 20 + 30);

  const v = b.union(a);
  expect([v.stages, v.count, v.capacity]).toEqual([
    u.stages,
    u.count,
    u.capacity,
  ]);
});

test("union leaves both inputs unchanged", () => {
  const a = filled(aKeys);
  const b = filled(bKeys);
  const snapshot = (f: ScalableBloomFilter) => [
    f.stages,
    f.count,
    f.m,
    f.rate(),
  ];
  const before = [snapshot(a), snapshot(b)];

  a.union(b);
  b.union(a);

  expect([snapshot(a), snapshot(b)]).toEqual(before);
});
