import { describe, expect, test } from "vitest";

import type { DDSketch } from "../../src/ddsketch/ddsketch.js";
import type { MappingKind } from "../../src/ddsketch/mapping.js";
import { fromProtobuf } from "../../src/ddsketch/protobuf/protobuf.js";
import { fromBase64 } from "../helpers/base64.js";
import { expectWithin } from "../helpers/quantile.js";
import fixture from "../fixtures/ddsketch/protobuf.go.json" with { type: "json" };

interface ProtoCase {
  name: string;
  relativeAccuracy: number;
  store: string;
  values: number[];
  weight?: number;
  message: string;
  gamma: number;
  indexOffset: number;
  interpolation: number;
  zeroCount: number;
  positive: number[][];
  negative: number[][];
}

const cases = fixture.cases as ProtoCase[];
const KINDS: MappingKind[] = ["log", "linear", "quadratic", "cubic"];

// The bins a sketch holds, read back from its type 10 frame: posBins and
// negBins at body offset 64, then every count, then every index.
function binsOf(sketch: DDSketch): {
  positive: number[][];
  negative: number[][];
  zeroCount: number;
} {
  const frame = sketch.toBytes();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const body = 16;
  const pos = view.getUint32(body + 64, true);
  const neg = view.getUint32(body + 68, true);
  const counts = body + 72;
  const indices = counts + 8 * (pos + neg);
  const pair = (i: number): number[] => [
    view.getInt32(indices + 4 * i, true),
    view.getFloat64(counts + 8 * i, true),
  ];
  return {
    positive: Array.from({ length: pos }, (_, i) => pair(i)),
    negative: Array.from({ length: neg }, (_, i) => pair(pos + i)),
    zeroCount: view.getFloat64(body + 56, true),
  };
}

describe.each(cases)("sketches-go's $name message", (c) => {
  const sketch = fromProtobuf(fromBase64(c.message));

  test("decodes to its mapping", () => {
    expect(sketch.mapping.kind).toBe(KINDS[c.interpolation]);
    expect(sketch.mapping.gamma).toBe(c.gamma);
    expect(sketch.mapping.indexOffset).toBe(c.indexOffset);
  });

  test("decodes to the bins sketches-go held", () => {
    expect(binsOf(sketch)).toEqual({
      positive: c.positive,
      negative: c.negative,
      zeroCount: c.zeroCount,
    });
  });

  test("lands on a dense store, as sketches-go's FromProto does", () => {
    expect(sketch.store.kind).toBe("dense");
  });

  // The message carries no min or max; they come back as the extreme bins'
  // values, within the accuracy of the truth.
  test("derives min and max within the accuracy", () => {
    if (c.values.length === 0) {
      expect(sketch.count).toBe(0);
      return;
    }
    expectWithin(sketch.min, Math.min(...c.values), c.relativeAccuracy);
    expectWithin(sketch.max, Math.max(...c.values), c.relativeAccuracy);
  });
});
