import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  FORMAT_VERSION,
  SerializationError,
  TruncatedError,
  UnknownHashVariantError,
  writeHeader,
} from "../../src/core/serialize.js";
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

describe("canonical bytes", () => {
  // Integers keep sum exact, so any byte difference is ordering, not rounding.
  test("insertion order does not change the bytes", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.integer({ min: -1e6, max: 1e6 }), { maxLength: 100 })
          .chain((values) =>
            fc.tuple(
              fc.constant(values),
              fc.shuffledSubarray(values, {
                minLength: values.length,
                maxLength: values.length,
              }),
            ),
          ),
        ([values, shuffled]) => {
          expect(DDSketch.from(shuffled, 0.01).toBytes()).toEqual(
            DDSketch.from(values, 0.01).toBytes(),
          );
        },
      ),
    );
  });

  test("dense and sparse stores write the same bins", () => {
    const values = mixed(51, 300);
    const payload = (frame: Uint8Array): Uint8Array =>
      frame.subarray(BODY + 64, frame.length - 4);
    expect(
      payload(DDSketch.from(values, 0.01, { store: sparseStore() }).toBytes()),
    ).toEqual(
      payload(DDSketch.from(values, 0.01, { store: denseStore() }).toBytes()),
    );
  });

  test("-0 is recorded as 0", () => {
    const a = DDSketch.from([0, -0], 0.01);
    const b = DDSketch.from([-0, 0], 0.01);
    expect(a.toBytes()).toEqual(b.toBytes());
    expect(Object.is(b.min, 0)).toBe(true);
  });
});

// A valid frame's body, edited and resealed with a correct CRC, so each forged
// frame reaches DDSketch's own checks rather than stopping at the trailer.
const VALID = DDSketch.from([1, 2, -3, 0], 0.01, { store: denseStore() });
function forge(
  mutate: (body: Uint8Array, view: DataView) => Uint8Array | undefined,
  flags = 0,
): Uint8Array {
  const frame = VALID.toBytes();
  const body = frame.slice(BODY, frame.length - 4);
  const edited =
    mutate(body, new DataView(body.buffer, body.byteOffset, body.byteLength)) ??
    body;
  return writeHeader({ version: FORMAT_VERSION, type: 10, flags }, edited);
}

describe("a structurally broken frame is rejected", () => {
  test("every truncated prefix", () => {
    const frame = DDSketch.from(mixed(52, 200), 0.01).toBytes();
    for (let n = 0; n < frame.length; n += 7) {
      expect(() => DDSketch.fromBytes(frame.subarray(0, n))).toThrow(
        SerializationError,
      );
    }
  });

  test("a body shorter than the params block", () => {
    expect(() =>
      DDSketch.fromBytes(forge((body) => body.subarray(0, 40))),
    ).toThrow(TruncatedError);
  });

  test("a body whose length disagrees with its bin counts", () => {
    expect(() =>
      DDSketch.fromBytes(
        forge((_, view) => {
          view.setUint32(64, view.getUint32(64, true) + 1, true);
          return undefined;
        }),
      ),
    ).toThrow(TruncatedError);
  });

  test("a hash variant other than none", () => {
    expect(() => DDSketch.fromBytes(forge(() => undefined, 1))).toThrow(
      UnknownHashVariantError,
    );
  });

  test.each<[string, (view: DataView) => void]>([
    [
      "an unknown mapping",
      (view) => {
        view.setUint8(0, 4);
      },
    ],
    [
      "an unknown store",
      (view) => {
        view.setUint8(1, 4);
      },
    ],
    [
      "non-zero reserved bytes",
      (view) => {
        view.setUint16(2, 1, true);
      },
    ],
    [
      "a bound on an unbounded store",
      (view) => {
        view.setUint32(4, 5, true);
      },
    ],
    [
      "a collapsing store with no bound",
      (view) => {
        view.setUint8(1, 1);
        view.setUint32(4, 0, true);
      },
    ],
  ])("%s", (_, mutate) => {
    expect(() =>
      DDSketch.fromBytes(
        forge((__, view) => {
          mutate(view);
          return undefined;
        }),
      ),
    ).toThrow(SerializationError);
  });
});
