import { expect, test } from "vitest";

import { CountMinSketch } from "../../src/countmin/countmin.js";
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
