import { describe, expect, test } from "vitest";

import { DDSketch, type DDSketchOptions } from "../../src/ddsketch/ddsketch.js";
import {
  cubicMapping,
  linearMapping,
  logMapping,
  quadraticMapping,
} from "../../src/ddsketch/mapping.js";
import {
  collapsingHighestStore,
  collapsingLowestStore,
  denseStore,
  sparseStore,
} from "../../src/ddsketch/store.js";
import { rng } from "../helpers/frequency.js";
import { lognormalValues } from "../helpers/quantile.js";

const BODY = 16;
const QS = [0, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999, 1];

function mixed(seed: number, n: number): number[] {
  const sign = rng(seed);
  const values = lognormalValues(seed + 1, n).map((v) =>
    sign() < 0.4 ? -v : v,
  );
  for (let i = 0; i < n / 20; i++) values.push(0);
  return values;
}

const cases: [string, number[], DDSketchOptions][] = [
  ["empty", [], {}],
  ["mixed-sign with zeros", mixed(41, 500), {}],
  ["log", mixed(42, 300), { mapping: logMapping }],
  ["linear", mixed(43, 300), { mapping: linearMapping }],
  ["quadratic", mixed(44, 300), { mapping: quadraticMapping }],
  ["cubic", mixed(45, 300), { mapping: cubicMapping }],
  ["dense", mixed(46, 300), { store: denseStore() }],
  ["sparse", mixed(47, 300), { store: sparseStore() }],
  ["collapsing-lowest", mixed(48, 300), { store: collapsingLowestStore(2048) }],
  ["collapsing-highest", mixed(49, 300), { store: collapsingHighestStore(64) }],
  [
    "collapsed",
    lognormalValues(50, 2000).map((v) => v ** 4),
    { store: collapsingLowestStore(8) },
  ],
];

describe.each(cases)("a %s sketch", (_, values, options) => {
  const sketch = DDSketch.from(values, 0.01, options);
  const frame = sketch.toBytes();
  const back = DDSketch.fromBytes(frame);

  test("re-encodes to the same bytes", () => {
    expect(back.toBytes()).toEqual(frame);
  });

  test("decodes to the same sketch", () => {
    expect([
      back.count,
      back.sum,
      back.min,
      back.max,
      back.relativeAccuracy,
      back.mapping.kind,
      back.store.kind,
      back.store.maxBins,
    ]).toEqual([
      sketch.count,
      sketch.sum,
      sketch.min,
      sketch.max,
      sketch.relativeAccuracy,
      sketch.mapping.kind,
      sketch.store.kind,
      sketch.store.maxBins,
    ]);
    if (sketch.count > 0)
      expect(back.quantiles(QS)).toEqual(sketch.quantiles(QS));
  });
});

test("the frame follows the documented layout", () => {
  const sketch = DDSketch.from([1, -2, 0], 0.01, {
    mapping: cubicMapping,
    store: collapsingHighestStore(64),
  });
  const frame = sketch.toBytes();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  expect(frame[5]).toBe(10);
  expect(frame[6]).toBe(0);
  expect(frame[BODY + 0]).toBe(3);
  expect(frame[BODY + 1]).toBe(2);
  expect(view.getUint16(BODY + 2, true)).toBe(0);
  expect(view.getUint32(BODY + 4, true)).toBe(64);
  expect(view.getFloat64(BODY + 8, true)).toBe(sketch.mapping.gamma);
  expect(view.getFloat64(BODY + 24, true)).toBe(0.01);
  expect(view.getFloat64(BODY + 56, true)).toBe(1);
  expect(view.getUint32(BODY + 64, true)).toBe(1);
  expect(view.getUint32(BODY + 68, true)).toBe(1);
});
