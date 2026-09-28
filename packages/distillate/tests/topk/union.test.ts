import { expect, test } from "vitest";

import { TopK, TopKParamMismatchError } from "../../src/topk/topk.js";
import { truthOf, zipfStream } from "../helpers/frequency.js";
import { expectOneSided } from "../helpers/topk.js";

// A differing seed matters as much as a differing capacity: the same key would
// hash elsewhere, and the error naming both values says which side to rebuild.
test.each<[string, TopK, RegExp]>([
  ["capacity", new TopK({ capacity: 32 }), /capacity 16 and 32/],
  ["seed", new TopK({ capacity: 16, seed: 7 }), /seed 0 and 7/],
])("a union across a differing %s is refused", (_, other, message) => {
  const a = new TopK({ capacity: 16 });

  expect(() => a.union(other)).toThrow(TopKParamMismatchError);
  expect(() => a.union(other)).toThrow(message);
});

test("a union sums each key's count, the offsets and the totals", () => {
  const a = new TopK({ capacity: 64 });
  a.add("x", 3);
  a.add("y", 2);
  const b = new TopK({ capacity: 64 });
  b.add("x", 1);
  b.add("z", 4);
  const beforeA = a.toBytes();
  const beforeB = b.toBytes();

  const u = a.union(b);

  expect(u.count("x")).toBe(4);
  expect(u.count("y")).toBe(2);
  expect(u.count("z")).toBe(4);
  expect(u.total).toBe(10);
  expect(u.error()).toBe(0);
  expect(a.toBytes()).toEqual(beforeA);
  expect(b.toBytes()).toEqual(beforeB);
});

test("a union with an empty sketch is the other side", () => {
  const a = new TopK({ capacity: 64 });
  a.add("x", 3);
  a.add("y", 2);
  const empty = new TopK({ capacity: 64 });

  expect(a.union(empty).toBytes()).toEqual(a.toBytes());
  expect(empty.union(a).toBytes()).toEqual(a.toBytes());
});

const heavy = zipfStream(71, 2_000, 20_000, 1.1);
const flatter = zipfStream(72, 2_000, 20_000, 0.8);
const small = ["key:0", "key:0", "key:5"];

const fed = (stream: string[]): TopK => {
  const s = new TopK({ capacity: 64 });
  for (const key of stream) s.add(key);
  return s;
};

test.each<[string, string[], string[]]>([
  ["both sides", heavy, flatter],
  ["the left side only", heavy, small],
  ["the right side only", small, flatter],
])(
  "a union after a purge on %s holds the guarantee in either order",
  (_, streamA, streamB) => {
    const a = fed(streamA);
    const b = fed(streamB);
    for (const [s, stream] of [
      [a, streamA],
      [b, streamB],
    ] as const) {
      if (stream !== small) expect(s.error()).toBeGreaterThan(0);
    }
    const truth = truthOf([...streamA, ...streamB]);

    for (const u of [a.union(b), b.union(a)]) {
      expectOneSided(u, truth);
      expect(u.total).toBe(a.total + b.total);
      expect(u.error()).toBeGreaterThanOrEqual(a.error() + b.error());
    }
  },
);
