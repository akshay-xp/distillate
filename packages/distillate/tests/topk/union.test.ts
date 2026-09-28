import { expect, test } from "vitest";

import { TopK, TopKParamMismatchError } from "../../src/topk/topk.js";

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
