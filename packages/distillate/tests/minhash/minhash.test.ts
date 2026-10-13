import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { MinHash } from "../../src/minhash/minhash.js";

describe("construction", () => {
  test("defaults to 128 slots and seed 0", () => {
    const sketch = new MinHash();
    expect(sketch.k).toBe(128);
    expect(sketch.seed).toBe(0);
    expect(sketch.isEmpty).toBe(true);
  });

  test("reports the worst-case Jaccard standard error", () => {
    expect(new MinHash({ k: 256, seed: 7 }).standardError).toBe(0.5 / 16);
  });

  test.each([1, 4097, 2.5, Number.NaN])("rejects k = %s", (k) => {
    expect(() => new MinHash({ k })).toThrow(ParamError);
  });

  test.each([-1, 2 ** 32])("rejects seed = %s", (seed) => {
    expect(() => new MinHash({ seed })).toThrow(ParamError);
  });
});
