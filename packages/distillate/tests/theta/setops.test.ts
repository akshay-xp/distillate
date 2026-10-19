import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { ThetaSketch } from "../../src/theta/theta.js";

// Keys `from` to `to - 1`.
const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from }, (_, i) => `key:${String(from + i)}`);

function sketchOf(items: readonly string[], k = 1024, seed = 0): ThetaSketch {
  const sketch = new ThetaSketch({ k, seed });
  for (const item of items) sketch.add(item);
  return sketch;
}

const A = range(0, 600);
const B = range(400, 1000);

describe("union", () => {
  test("is the sketch of the union set and leaves both inputs as they were", () => {
    const a = sketchOf(A);
    const b = sketchOf(B);
    const union = a.union(b);
    expect(union.equals(sketchOf(range(0, 1000)))).toBe(true);
    expect(union.count()).toBe(1000);
    expect(a.count()).toBe(600);
    expect(b.count()).toBe(600);
    expect(a.equals(sketchOf(A))).toBe(true);
    expect(b.equals(sketchOf(B))).toBe(true);
  });

  test("refuses a sketch with a different seed", () => {
    expect(() => sketchOf(A).union(sketchOf(B, 1024, 1))).toThrow(ParamError);
  });

  test("gives a sketch that takes more keys", () => {
    const union = sketchOf(A).union(sketchOf(B));
    union.add("key:1000");
    expect(union.count()).toBe(1001);
  });
});
