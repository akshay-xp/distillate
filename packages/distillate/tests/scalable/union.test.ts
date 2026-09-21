import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import { ParamError } from "../../src/core/params.js";
import {
  ScalableBloomFilter,
  type ScalableBloomParams,
  ScalableParamMismatchError,
} from "../../src/scalable/scalable.js";

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

test.each<[keyof ScalableBloomParams, Partial<ScalableBloomParams>]>([
  ["n", { n: 11 }],
  ["epsilon", { epsilon: 0.02 }],
  ["growth", { growth: 3 }],
  ["tightening", { tightening: 0.5 }],
  ["seed", { seed: 1 }],
])("union refuses filters whose %s differs", (name, change) => {
  const settings = {
    n: 10,
    epsilon: 0.01,
    growth: 2,
    tightening: 0.85,
    seed: 0,
  };
  const base = new ScalableBloomFilter(settings);
  const other = new ScalableBloomFilter({ ...settings, ...change });

  let thrown: unknown;
  try {
    base.union(other);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(ScalableParamMismatchError);
  expect(thrown).not.toBeInstanceOf(ParamError);
  expect((thrown as Error).message).toContain(name);
});

test("equals holds for identical filters and breaks on any difference", () => {
  const keys = range("e", 25);
  expect(filled(keys).equals(filled(keys))).toBe(true);

  const plusOne = filled(keys);
  plusOne.add("extra");
  expect(filled(keys).equals(plusOne)).toBe(false);

  const seeded = ScalableBloomFilter.create(10, 0.01, { seed: 1 });
  for (const key of keys) seeded.add(key);
  expect(filled(keys).equals(seeded)).toBe(false);

  expect(filled([]).equals(filled([]))).toBe(true);
});

test("union is symmetric under equals", () => {
  const a = filled(aKeys);
  const b = filled(bKeys);
  expect(a.union(b).equals(b.union(a))).toBe(true);
});

test("the same keys in another order can land in other stages", () => {
  // Which stage a key lands in depends on when it arrived, so equality is of
  // the filter's state, the same as its serialized bytes, not of its key set.
  const keys = range("e", 25);
  expect(filled(keys).equals(filled([...keys].reverse()))).toBe(false);
});

test("union refuses stages whose stored geometry differs", () => {
  // A frame stores its stage geometry rather than re-deriving it, so equal
  // settings do not by themselves guarantee equal stages.
  const frame = ScalableBloomFilter.create(10, 0.01).toBytes();
  const view = new DataView(frame.buffer);
  const kAt = 16 + 40 + 4;
  view.setUint16(kAt, view.getUint16(kAt, true) + 1, true);
  view.setUint32(
    frame.length - 4,
    crc32(frame.subarray(0, frame.length - 4)),
    true,
  );
  const restored = ScalableBloomFilter.fromBytes(frame);

  expect(() => restored.union(ScalableBloomFilter.create(10, 0.01))).toThrow(
    ScalableParamMismatchError,
  );
  expect(() => restored.union(ScalableBloomFilter.create(10, 0.01))).toThrow(
    /stage 0/,
  );
});
