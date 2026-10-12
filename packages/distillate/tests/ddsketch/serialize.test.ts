import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  FORMAT_VERSION,
  SerializationError,
  TruncatedError,
  UnknownHashVariantError,
  writeHeader,
} from "../../src/core/serialize.js";
import { CountMinSketch } from "../../src/countmin/countmin.js";
import { DDSketch, type DDSketchOptions } from "../../src/ddsketch/ddsketch.js";
import {
  fromProtobuf,
  toProtobuf,
} from "../../src/ddsketch/protobuf/protobuf.js";
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
import { readFrameBins } from "../helpers/ddsketch-frame.js";
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
  // One bin a side: each a contiguous run of one u32 count, starting at it.
  const { positive, negative } = readFrameBins(frame);
  for (const block of [positive, negative]) {
    expect([block.contiguous, block.f64, block.n]).toEqual([true, false, 1]);
  }
  expect(positive.start).toBe(sketch.mapping.index(1));
  expect(negative.start).toBe(sketch.mapping.index(2));
});

describe("each sign takes the smaller layout its bins allow", () => {
  test("a dense run of whole counts is contiguous u32", () => {
    // 100 to 1099 fill their bins densely; down at 1 to 100 most of each
    // octave's 64 bins stay empty and pairs come out smaller.
    const values = Array.from({ length: 1000 }, (_, i) => i + 100);
    const sketch = DDSketch.from(values, 0.01, { store: denseStore() });
    const { positive } = readFrameBins(sketch.toBytes());
    expect([positive.contiguous, positive.f64]).toEqual([true, false]);
    expect(positive.start).toBe(sketch.mapping.index(100));
    expect(positive.n).toBe(sketch.mapping.index(1099) - positive.start + 1);
  });

  test("bins far apart are written as pairs", () => {
    const { positive } = readFrameBins(
      DDSketch.from([1, 1e10], 0.01).toBytes(),
    );
    expect([positive.contiguous, positive.n]).toEqual([false, 2]);
  });

  test("a fractional count makes the sign's counts f64", () => {
    const sketch = DDSketch.create(0.01);
    sketch.add(5, 2.5);
    sketch.add(-5);
    const { positive, negative } = readFrameBins(sketch.toBytes());
    expect([positive.f64, negative.f64]).toEqual([true, false]);
  });

  test("an empty sign is an empty list of pairs", () => {
    const { positive, negative } = readFrameBins(
      DDSketch.from([0], 0.01).toBytes(),
    );
    for (const block of [positive, negative]) {
      expect([block.contiguous, block.f64, block.n, block.start]).toEqual([
        false,
        false,
        0,
        0,
      ]);
    }
  });

  // The point of the layout: a latency stream's frame is smaller than the
  // protobuf message Datadog's libraries write for the same bins.
  test("a lognormal stream's frame is smaller than its protobuf message", () => {
    const sketch = DDSketch.from(lognormalValues(55, 100_000), 0.01, {
      store: denseStore(),
    });
    expect(sketch.toBytes().length).toBeLessThan(toProtobuf(sketch).length);
  });
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
  base: DDSketch = VALID,
): Uint8Array {
  const frame = base.toBytes();
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

  test("another structure's frame", () => {
    const frame = CountMinSketch.create(0.01, 0.01).toBytes();
    expect(() => DDSketch.fromBytes(frame)).toThrow(SerializationError);
  });

  test("a body shorter than the params block", () => {
    expect(() =>
      DDSketch.fromBytes(forge((body) => body.subarray(0, 40))),
    ).toThrow(TruncatedError);
  });

  // VALID's negative block header starts at 96; a body of 100 passes the
  // minimum length and ends inside it.
  test("a body that ends inside a block header", () => {
    expect(() =>
      DDSketch.fromBytes(forge((body) => body.subarray(0, 100))),
    ).toThrow(TruncatedError);
  });

  test("a body whose length disagrees with its bin counts", () => {
    expect(() =>
      DDSketch.fromBytes(
        forge((_, view) => {
          view.setUint32(68, view.getUint32(68, true) + 100, true);
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

// VALID holds bins for 1 and 2 (positive), 3 (negative) and one zero. Bins
// for 1 and 2 are a power of two apart, so the positive block is u32 pairs:
// header at 64, counts at 80 and 84, indices at 88 and 92. The negative block
// is a contiguous run of one: header at 96, its count at 112, padding to 120.
const COUNT0 = 80;
const INDEX0 = 88;
const INDEX1 = 92;
const NEG = 96;

// The same shape with fractional counts, so the positive counts are f64:
// counts at 80 and 88, indices at 96 and 100.
const VALID_F64 = DDSketch.create(0.01, { store: denseStore() });
VALID_F64.add(1, 2.5);
VALID_F64.add(2, 1.5);
VALID_F64.add(-3);
VALID_F64.add(0);

describe("a frame whose contents cannot be true is rejected", () => {
  const edits: [string, (view: DataView) => void][] = [
    [
      "unsorted indices",
      (v) => {
        v.setInt32(INDEX0, v.getInt32(INDEX1, true) + 1, true);
      },
    ],
    [
      "a duplicate index",
      (v) => {
        v.setInt32(INDEX0, v.getInt32(INDEX1, true), true);
      },
    ],
    [
      "a zero count",
      (v) => {
        v.setUint32(COUNT0, 0, true);
      },
    ],
    [
      "a contiguous run that ends on an empty slot",
      (v) => {
        v.setUint32(NEG + 16, 0, true);
      },
    ],
    [
      "set reserved bits in a block's layout byte",
      (v) => {
        v.setUint8(NEG, v.getUint8(NEG) | 4);
      },
    ],
    [
      "non-zero reserved bytes in a block header",
      (v) => {
        v.setUint8(NEG + 13, 1);
      },
    ],
    [
      "a start on a block of pairs",
      (v) => {
        v.setInt32(64 + 8, 5, true);
      },
    ],
    [
      "non-zero padding after a block",
      (v) => {
        v.setUint8(NEG + 20, 1);
      },
    ],
    // The same bins in the other layout or count width are a second encoding
    // of one sketch, which would break equals as byte equality.
    [
      "f64 counts that fit u32",
      (v) => {
        v.setUint8(NEG, 3);
        v.setFloat64(NEG + 16, 1, true);
      },
    ],
    [
      "pairs where the contiguous run is smaller",
      (v) => {
        const start = v.getInt32(NEG + 8, true);
        v.setUint8(NEG, 0);
        v.setInt32(NEG + 8, 0, true);
        v.setInt32(NEG + 20, start, true);
      },
    ],
    [
      "an index outside the mapping's range",
      (v) => {
        v.setInt32(INDEX0, -(2 ** 31), true);
      },
    ],
    [
      "a collapsing frame wider than maxBins",
      (v) => {
        v.setUint8(1, 1);
        v.setUint32(4, 1, true);
      },
    ],
    [
      "gamma of 1",
      (v) => {
        v.setFloat64(8, 1, true);
      },
    ],
    [
      "a NaN gamma",
      (v) => {
        v.setFloat64(8, Number.NaN, true);
      },
    ],
    [
      "an infinite indexOffset",
      (v) => {
        v.setFloat64(16, Infinity, true);
      },
    ],
    [
      "an indexOffset so large no value can be indexed",
      (v) => {
        v.setFloat64(16, -6.8e38, true);
      },
    ],
    [
      "relativeAccuracy of 0",
      (v) => {
        v.setFloat64(24, 0, true);
      },
    ],
    [
      "relativeAccuracy of 1",
      (v) => {
        v.setFloat64(24, 1, true);
      },
    ],
    [
      "a negative zeroCount",
      (v) => {
        v.setFloat64(56, -1, true);
      },
    ],
    [
      "a NaN zeroCount",
      (v) => {
        v.setFloat64(56, Number.NaN, true);
      },
    ],
    [
      "min above max",
      (v) => {
        v.setFloat64(40, 5, true);
      },
    ],
    [
      "a NaN max",
      (v) => {
        v.setFloat64(48, Number.NaN, true);
      },
    ],
    [
      "an infinite sum",
      (v) => {
        v.setFloat64(32, Infinity, true);
      },
    ],
    [
      "a max below the highest bin",
      (v) => {
        v.setFloat64(48, 1, true);
      },
    ],
    [
      "a min above the most negative bin",
      (v) => {
        v.setFloat64(40, -1, true);
      },
    ],
  ];

  test.each(edits)("%s", (_, edit) => {
    expect(() =>
      DDSketch.fromBytes(
        forge((__, view) => {
          edit(view);
          return undefined;
        }),
      ),
    ).toThrow(SerializationError);
  });

  test.each<[string, (view: DataView) => void]>([
    [
      "a min on an empty sketch",
      (v) => {
        v.setFloat64(40, 0, true);
      },
    ],
    [
      "a sum on an empty sketch",
      (v) => {
        v.setFloat64(32, 1, true);
      },
    ],
  ])("%s", (_, edit) => {
    const empty = DDSketch.create(0.01, { store: denseStore() });
    expect(() =>
      DDSketch.fromBytes(
        forge(
          (__, view) => {
            edit(view);
            return undefined;
          },
          0,
          empty,
        ),
      ),
    ).toThrow(SerializationError);
  });

  test("a zero bin with a min above the indexable range", () => {
    const zeros = DDSketch.from([0, 5], 0.01, { store: denseStore() });
    expect(() =>
      DDSketch.fromBytes(
        forge(
          (__, view) => {
            view.setFloat64(40, 1, true);
            return undefined;
          },
          0,
          zeros,
        ),
      ),
    ).toThrow(SerializationError);
  });
});

// One body byte overwritten in a valid frame of a random small sketch. Every
// outcome is either a typed rejection or a sketch that answers finitely and
// re-encodes to exactly the bytes it was read from.
const corrupted = fc
  .tuple(
    fc.array(fc.integer({ min: -1000, max: 1000 }), {
      minLength: 1,
      maxLength: 20,
    }),
    fc.nat(),
    fc.nat({ max: 255 }),
  )
  .map(([values, at, byte]) => {
    const base = DDSketch.from(values, 0.01, { store: denseStore() });
    return forge(
      (body) => {
        body[at % body.length] = byte;
        return undefined;
      },
      0,
      base,
    );
  });

function outcome(frame: Uint8Array): "rejected" | "accepted" {
  let sketch: DDSketch;
  try {
    sketch = DDSketch.fromBytes(frame);
  } catch (err) {
    expect(err).toBeInstanceOf(SerializationError);
    return "rejected";
  }
  for (const v of sketch.quantiles(QS)) expect(Number.isFinite(v)).toBe(true);
  expect(sketch.toBytes()).toEqual(frame);
  return "accepted";
}

test("a corrupted frame is rejected or decodes faithfully (fuzz)", () => {
  fc.assert(
    fc.property(corrupted, (frame) => {
      outcome(frame);
    }),
    { numRuns: 500 },
  );
});

test("the corruption reaches both outcomes", () => {
  const seen = new Set(
    fc.sample(corrupted, { numRuns: 500, seed: 7 }).map(outcome),
  );
  expect([...seen].sort()).toEqual(["accepted", "rejected"]);
});

test("the JSON envelope round-trips", () => {
  const sketch = DDSketch.from(mixed(53, 200), 0.01);
  const json = JSON.parse(JSON.stringify(sketch.toJSON())) as unknown;
  expect(DDSketch.fromJSON(json).toBytes()).toEqual(sketch.toBytes());
});

test("equals is exactly byte equality of the frame (property)", () => {
  const small = fc.array(fc.integer({ min: -3, max: 3 }), { maxLength: 4 });
  fc.assert(
    fc.property(small, small, (x, y) => {
      const a = DDSketch.from(x, 0.01);
      const b = DDSketch.from(y, 0.01);
      const sameBytes =
        a.toBytes().length === b.toBytes().length &&
        a.toBytes().every((byte, i) => byte === b.toBytes()[i]);
      expect(a.equals(b)).toBe(sameBytes);
    }),
  );
});

test("sketches on different mappings are unequal rather than throwing", () => {
  const a = DDSketch.from([1, 2], 0.01);
  const b = DDSketch.from([1, 2], 0.01, { mapping: cubicMapping });
  expect(a.equals(b)).toBe(false);
});

describe("a frame with impossible float counts is rejected", () => {
  test.each<[string, number]>([
    ["a negative count", -1],
    ["a NaN count", Number.NaN],
    ["an infinite count", Infinity],
    ["a zero count", 0],
  ])("%s", (_, count) => {
    expect(() =>
      DDSketch.fromBytes(
        forge(
          (__, view) => {
            view.setFloat64(80, count, true);
            return undefined;
          },
          0,
          VALID_F64,
        ),
      ),
    ).toThrow(SerializationError);
  });
});

// -0 equals 0 to every comparison a reader makes, so without an explicit check
// it slips through as a second encoding of the same sketch.
describe("a frame carrying -0 is rejected", () => {
  const empty = DDSketch.create(0.01, { store: denseStore() });
  const gapped = DDSketch.create(0.01, { store: denseStore() });
  gapped.add(gapped.mapping.value(100), 0.5);
  gapped.add(gapped.mapping.value(102), 0.5);

  test.each<[string, DDSketch, number]>([
    ["a -0 sum", empty, 32],
    ["a -0 zeroCount", empty, 56],
    ["a -0 interior slot in a contiguous f64 run", gapped, 88],
  ])("%s", (_, base, at) => {
    const frame = forge(
      (__, view) => {
        expect(view.getFloat64(at, true)).toBe(0);
        view.setFloat64(at, -0, true);
        return undefined;
      },
      0,
      base,
    );
    expect(() => DDSketch.fromBytes(frame)).toThrow(SerializationError);
  });
});

// Indexable values can sum past the largest double: the sum is then Infinity,
// or NaN once both signs overflow, and the frame must still carry it.
describe("a sketch whose sum overflows round-trips", () => {
  const of = (...values: number[]): DDSketch => DDSketch.from(values, 0.01);
  test.each<[string, () => DDSketch]>([
    ["+Infinity from add", () => of(1e308, 1e308)],
    ["-Infinity from add", () => of(-1e308, -1e308)],
    ["NaN from both signs", () => of(1e308, 1e308, -1e308, -1e308)],
    ["+Infinity from union", () => of(1e308).union(of(1e308))],
    [
      "+Infinity from protobuf",
      () => fromProtobuf(toProtobuf(of(1e308, 1e308))),
    ],
  ])("%s", (_, build) => {
    const sketch = build();
    expect(Number.isFinite(sketch.sum)).toBe(false);
    for (const back of [
      DDSketch.fromBytes(sketch.toBytes()),
      DDSketch.fromJSON(sketch.toJSON()),
    ]) {
      expect(back.equals(sketch)).toBe(true);
      expect(Object.is(back.sum, sketch.sum)).toBe(true);
    }
  });
});

describe("a non-finite sum the bins cannot produce is rejected", () => {
  const small = DDSketch.from([1, 2, 3], 0.01);
  const high = DDSketch.from([1e308, 1e308], 0.01);
  const both = DDSketch.from([1e308, 1e308, -1e308, -1e308], 0.01);
  const sumAt = (view: DataView, value: number): undefined => {
    view.setFloat64(32, value, true);
    return undefined;
  };
  test.each<[string, DDSketch, (view: DataView) => undefined]>([
    [
      "+Infinity from small bins",
      small,
      (v) => {
        sumAt(v, Infinity);
      },
    ],
    [
      "-Infinity from positive bins",
      high,
      (v) => {
        sumAt(v, -Infinity);
      },
    ],
    [
      "NaN with one side able to overflow",
      high,
      (v) => {
        sumAt(v, NaN);
      },
    ],
    [
      "a NaN other than the one a writer writes",
      both,
      (v) => {
        v.setUint32(32, 1, true);
        v.setUint32(36, 0x7ff80000, true);
        return undefined;
      },
    ],
  ])("%s", (_, base, edit) => {
    const frame = forge(
      (__, view) => {
        edit(view);
      },
      0,
      base,
    );
    expect(() => DDSketch.fromBytes(frame)).toThrow(SerializationError);
  });
});
