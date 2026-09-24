import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { countMinSizing } from "../../src/countmin/sizing.js";

test("countMinSizing(0.001, 0.001) pins exact width and depth", () => {
  expect(countMinSizing(0.001, 0.001)).toEqual({ width: 2719, depth: 7 });
});

test("countMinSizing solves width from epsilon and depth from delta", () => {
  for (const epsilon of [0.1, 0.01, 0.001, 0.0001]) {
    for (const delta of [0.1, 0.01, 0.001]) {
      const { width, depth } = countMinSizing(epsilon, delta);
      expect(width).toBe(Math.ceil(Math.E / epsilon));
      expect(depth).toBe(Math.ceil(Math.log(1 / delta)));
    }
  }
});

test("countMinSizing rejects non-probabilities", () => {
  for (const bad of [0, 1, Number.NaN]) {
    expect(() => countMinSizing(bad, 0.01)).toThrow(ParamError);
    expect(() => countMinSizing(0.01, bad)).toThrow(ParamError);
  }
});
