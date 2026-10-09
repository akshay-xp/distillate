import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import {
  type IndexMapping,
  type MappingKind,
  logMapping,
  mappingWithGamma,
} from "../../src/ddsketch/mapping.js";
import goFixture from "../fixtures/ddsketch/mappings.go.json" with { type: "json" };

interface FixtureEntry {
  kind: string;
  relativeAccuracy: number;
  gamma: number;
  indexOffset: number;
  minIndexableValue: number;
  maxIndexableValue: number;
  cases: number[][];
}

const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));

const kinds: [
  MappingKind,
  (relativeAccuracy: number) => IndexMapping,
  FixtureEntry[],
][] = [["log", logMapping, goFixture.mappings]];

describe.each(kinds)("%s mapping", (kind, factory, fixture) => {
  const entries = fixture.filter((e) => e.kind === kind);

  test("the fixture covers three accuracies", () => {
    expect(entries.map((e) => e.relativeAccuracy)).toEqual([0.05, 0.01, 0.001]);
  });

  test.each(entries)("bins as the reference at $relativeAccuracy", (e) => {
    const m = mappingWithGamma(kind, e.gamma, e.indexOffset);
    for (const [v, want] of e.cases as [number, number][]) {
      const got = m.index(v);
      if (got === want) continue;
      // V8's Math.log and the reference's log can differ by an ulp, which
      // moves a value sitting exactly on a bin boundary to the adjacent bin.
      // Only the log mapping calls a libm log in index().
      expect(kind).toBe("log");
      expect(Math.abs(got - want)).toBe(1);
      expect(near(v, m.lowerBound(Math.max(got, want)))).toBe(true);
    }
  });

  test.each(entries)(
    "derives the reference's parameters at $relativeAccuracy",
    (e) => {
      const m = factory(e.relativeAccuracy);
      expect(m.kind).toBe(kind);
      expect(near(m.gamma, e.gamma)).toBe(true);
      expect(m.indexOffset).toBe(e.indexOffset);
      expect(near(m.minIndexableValue, e.minIndexableValue)).toBe(true);
      expect(near(m.maxIndexableValue, e.maxIndexableValue)).toBe(true);
    },
  );

  test.each([0.05, 0.01, 0.001])(
    "value(index(v)) is within %s of v across the indexable range",
    (relativeAccuracy) => {
      const m = factory(relativeAccuracy);
      const lo = Math.log(m.minIndexableValue);
      const hi = Math.log(m.maxIndexableValue);
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (t) => {
          const v = Math.min(
            m.maxIndexableValue,
            Math.max(m.minIndexableValue, Math.exp(lo + t * (hi - lo))),
          );
          const error = Math.abs(m.value(m.index(v)) - v) / v;
          expect(error).toBeLessThanOrEqual(relativeAccuracy * (1 + 1e-12));
        }),
        { numRuns: 1000 },
      );
    },
  );

  test("rejects an accuracy outside (0, 1)", () => {
    for (const bad of [0, 1, -0.1, Number.NaN]) {
      expect(() => factory(bad)).toThrow(ParamError);
    }
  });
});
