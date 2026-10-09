import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import { cubicMapping } from "../../src/ddsketch/mapping.js";

describe("create", () => {
  test("reports the accuracy it was built for and the log mapping by default", () => {
    const sketch = DDSketch.create(0.01);
    expect(sketch.relativeAccuracy).toBe(0.01);
    expect(sketch.mapping.kind).toBe("log");
  });

  test("takes a mapping factory", () => {
    expect(DDSketch.create(0.01, { mapping: cubicMapping }).mapping.kind).toBe(
      "cubic",
    );
  });

  test("rejects an accuracy outside (0, 1)", () => {
    for (const bad of [0, 1, -0.1, Number.NaN]) {
      expect(() => DDSketch.create(bad)).toThrow(ParamError);
    }
  });
});
