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
