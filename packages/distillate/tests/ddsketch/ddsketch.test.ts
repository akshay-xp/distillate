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

describe("summaries", () => {
  test("count, sum, min and max are exact", () => {
    const sketch = DDSketch.create(0.01);
    for (const v of [3, 1, 2]) sketch.add(v);
    expect(sketch.count).toBe(3);
    expect(sketch.sum).toBe(6);
    expect(sketch.min).toBe(1);
    expect(sketch.max).toBe(3);
  });

  test("an empty sketch has no min or max", () => {
    const sketch = DDSketch.create(0.01);
    expect(sketch.count).toBe(0);
    expect(sketch.sum).toBe(0);
    expect(sketch.min).toBeNaN();
    expect(sketch.max).toBeNaN();
  });
});

describe("add", () => {
  test("rejects values and counts it cannot hold, recording nothing", () => {
    const sketch = DDSketch.create(0.01);
    const tooBig = sketch.mapping.maxIndexableValue * 2;
    for (const bad of [Number.NaN, Infinity, -Infinity, tooBig, -tooBig]) {
      expect(() => {
        sketch.add(bad);
      }).toThrow(ParamError);
    }
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      expect(() => {
        sketch.add(1, bad);
      }).toThrow(ParamError);
    }
    expect(sketch.count).toBe(0);
  });
});
