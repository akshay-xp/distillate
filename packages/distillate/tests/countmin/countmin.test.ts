import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import {
  CountMinSketch,
  type CountMinParams,
} from "../../src/countmin/countmin.js";

test("a sketch reports the geometry it was built with", () => {
  const s = new CountMinSketch({ width: 100, depth: 4 });

  expect(s.width).toBe(100);
  expect(s.depth).toBe(4);
  expect(s.seed).toBe(0);
});

test("a seed passed to the constructor is kept", () => {
  expect(new CountMinSketch({ width: 100, depth: 4, seed: 7 }).seed).toBe(7);
});

test.each<[string, Partial<CountMinParams>]>([
  ["width 0", { width: 0 }],
  ["width 1.5", { width: 1.5 }],
  ["width 2^32", { width: 2 ** 32 }],
  ["depth 0", { depth: 0 }],
  ["depth 1.5", { depth: 1.5 }],
  ["depth 2^32", { depth: 2 ** 32 }],
  ["seed -1", { seed: -1 }],
  ["seed 2^32", { seed: 2 ** 32 }],
  // Counter positions are 32-bit offsets into one flat array, like BloomFilter's m.
  ["width * depth past 2^32 - 1", { width: 2 ** 31, depth: 3 }],
])("%s is rejected with ParamError", (_, bad) => {
  expect(() => new CountMinSketch({ width: 100, depth: 4, ...bad })).toThrow(
    ParamError,
  );
});

test("create sizes the sketch from epsilon and delta", () => {
  const s = CountMinSketch.create(0.001, 0.001);

  expect(s.width).toBe(2719);
  expect(s.depth).toBe(7);
  expect(s.seed).toBe(0);
});

test("a seed passed to create is kept", () => {
  expect(CountMinSketch.create(0.01, 0.01, { seed: 7 }).seed).toBe(7);
});

test("create rejects non-probabilities", () => {
  expect(() => CountMinSketch.create(0, 0.01)).toThrow(ParamError);
  expect(() => CountMinSketch.create(0.01, 1)).toThrow(ParamError);
});
