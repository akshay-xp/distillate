import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { topKSizing } from "../../src/topk/sizing.js";
import { TopK } from "../../src/topk/topk.js";

test("create builds a sketch with the capacity the sizing solved for", () => {
  const sketch = TopK.create(0.01);

  expect(sketch.capacity).toBe(256);
  expect(sketch.capacity).toBe(topKSizing(0.01).capacity);
});

test("the seed defaults to 0 and is carried from options", () => {
  expect(TopK.create(0.01).seed).toBe(0);
  expect(TopK.create(0.01, { seed: 7 }).seed).toBe(7);
});

test("epsilon reports what the load limit delivers, not what was asked", () => {
  const sketch = TopK.create(0.01);

  expect(sketch.epsilon).toBe(1 / 192);
  expect(sketch.epsilon).toBeLessThanOrEqual(0.01);
});

test("the constructor refuses a capacity it cannot hold", () => {
  expect(() => new TopK({ capacity: 100 })).toThrow(ParamError);
  expect(() => new TopK({ capacity: 2 })).toThrow(ParamError);
  expect(() => new TopK({ capacity: 2 ** 25 })).toThrow(ParamError);
});

test("add records occurrences and count reads them back", () => {
  const sketch = TopK.create(0.01);

  expect(sketch.total).toBe(0);
  expect(sketch.count("alice")).toBe(0);

  sketch.add("alice");
  expect(sketch.count("alice")).toBe(1);

  sketch.add("alice");
  sketch.add("alice");
  sketch.add("alice");
  expect(sketch.count("alice")).toBe(4);

  sketch.add("alice", 5);
  expect(sketch.count("alice")).toBe(9);
  expect(sketch.total).toBe(9);
});

test("a key is one entry however it is spelled", () => {
  const sketch = TopK.create(0.01);
  const bytes = new TextEncoder().encode("alice");

  sketch.add("alice", 9);

  expect(sketch.count(bytes)).toBe(9);
  expect(sketch.count(bytes.buffer)).toBe(9);

  sketch.add(bytes);
  expect(sketch.count("alice")).toBe(10);
  expect(sketch.total).toBe(10);
});

test("a count that could produce an underestimate is refused", () => {
  const sketch = TopK.create(0.01);

  for (const bad of [0, -1, 1.5, Number.NaN]) {
    expect(() => {
      sketch.add("a", bad);
    }).toThrow(ParamError);
  }

  // The refusals must leave nothing behind, not even an occupied slot.
  expect(sketch.count("a")).toBe(0);
  expect(sketch.total).toBe(0);

  sketch.add("a", 2);
  expect(sketch.count("a")).toBe(2);
});
