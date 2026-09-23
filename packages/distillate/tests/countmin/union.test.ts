import { expect, test } from "vitest";

import {
  CountMinOverflowError,
  CountMinParamMismatchError,
  type CountMinParams,
  CountMinSketch,
} from "../../src/countmin/countmin.js";
import { sampleStrings } from "../helpers/fpr.js";

const streamA = sampleStrings(61, 200);
const streamB = sampleStrings(62, 200);

const fed = (...streams: string[][]): CountMinSketch => {
  const s = CountMinSketch.create(0.01, 0.01);
  for (const stream of streams) {
    stream.forEach((key, i) => {
      s.add(key, (i % 5) + 1);
    });
  }
  return s;
};

// The property plain increment was chosen for: a conservative sketch could
// combine soundly but could not reproduce the combined stream byte for byte.
test("a union is the sketch the combined stream would have produced", () => {
  const a = fed(streamA);
  const b = fed(streamB);
  const both = fed(streamA, streamB);
  const beforeA = a.toBytes();
  const beforeB = b.toBytes();

  const u = a.union(b);

  expect(u.toBytes()).toEqual(both.toBytes());
  expect(u.total).toBe(a.total + b.total);
  expect(a.toBytes()).toEqual(beforeA);
  expect(b.toBytes()).toEqual(beforeB);
});

// A seed difference matters as much as a geometry one: the same key would have
// landed in different columns, so adding the counters combines unrelated
// numbers and the result means nothing.
test.each<[string, CountMinParams]>([
  ["width", { width: 9, depth: 2 }],
  ["depth", { width: 8, depth: 3 }],
  ["seed", { width: 8, depth: 2, seed: 1 }],
])("a union across a differing %s is refused", (_, params) => {
  const a = new CountMinSketch({ width: 8, depth: 2 });

  expect(() => a.union(new CountMinSketch(params))).toThrow(
    CountMinParamMismatchError,
  );
});

// Without an explicit check a Uint32Array write wraps: 2^32 stores as 0, so
// the largest possible count would read as the smallest. That is an
// underestimate, the one outcome this structure rules out.
test("a union that would overflow a counter throws and changes nothing", () => {
  const a = new CountMinSketch({ width: 8, depth: 2 });
  const b = new CountMinSketch({ width: 8, depth: 2 });
  a.add("a", 0x80000000);
  b.add("a", 0x80000000);
  const beforeA = a.toBytes();
  const beforeB = b.toBytes();

  expect(() => a.union(b)).toThrow(CountMinOverflowError);
  expect(a.toBytes()).toEqual(beforeA);
  expect(b.toBytes()).toEqual(beforeB);
});
