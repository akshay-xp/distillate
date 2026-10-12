import { describe, expect, test } from "vitest";

import {
  DDSketch,
  sketchBins,
  sketchFromBins,
} from "../../src/ddsketch/ddsketch.js";
import {
  bitwiseMapping,
  cubicMapping,
  type IndexMapping,
  linearMapping,
  logMapping,
  type MappingKind,
  mappingWithGamma,
  quadraticMapping,
} from "../../src/ddsketch/mapping.js";
import {
  fromProtobuf,
  toProtobuf,
} from "../../src/ddsketch/protobuf/protobuf.js";
import {
  collapsingHighestStore,
  collapsingLowestStore,
  denseStore,
  sparseStore,
  type StoreFactory,
} from "../../src/ddsketch/store.js";
import { SerializationError } from "../../src/core/serialize.js";
import { fromBase64 } from "../helpers/base64.js";
import { rng } from "../helpers/frequency.js";
import { readFrameBins } from "../helpers/ddsketch-frame.js";
import { expectWithin } from "../helpers/quantile.js";
import fixture from "../fixtures/ddsketch/protobuf.go.json" with { type: "json" };
import { allocatedBy } from "../helpers/topk.js";

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

// The bins a sketch holds, read back from its type 10 frame by a reader
// written from the documented layout.
function binsOf(sketch: DDSketch): {
  positive: number[][];
  negative: number[][];
  zeroCount: number;
} {
  const { positive, negative, zeroCount } = readFrameBins(sketch.toBytes());
  return { positive: positive.bins, negative: negative.bins, zeroCount };
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

  test("lands on a store collapsing the lowest bins past 4096", () => {
    expect([sketch.store.kind, sketch.store.maxBins]).toEqual([
      "collapsingLowest",
      4096,
    ]);
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

// The same inputs, binned here on the gamma Go used, so any byte difference
// is the encoding and not the binning.
function rebuilt(c: ProtoCase, store = denseStore()): DDSketch {
  const kind = KINDS[c.interpolation] ?? "log";
  const sketch = DDSketch.create(c.relativeAccuracy, {
    mapping: () => mappingWithGamma(kind, c.gamma, c.indexOffset),
    store,
  });
  for (const v of c.values) sketch.add(v, c.weight ?? 1);
  return sketch;
}

describe("toProtobuf", () => {
  test.each(cases.filter((c) => c.store === "dense"))(
    "writes sketches-go's exact bytes for $name",
    (c) => {
      expect(toProtobuf(rebuilt(c))).toEqual(fromBase64(c.message));
    },
  );

  // sketches-go writes a sparse store as a map, whose entry order protobuf
  // leaves open, so the comparison is on what the message decodes to.
  test("writes the bins sketches-go holds for a sparse store", () => {
    const c = cases.find((x) => x.store === "sparse");
    if (!c) throw new Error("no sparse protobuf fixture");
    const back = fromProtobuf(toProtobuf(rebuilt(c, sparseStore())));
    expect(binsOf(back)).toEqual({
      positive: c.positive,
      negative: c.negative,
      zeroCount: c.zeroCount,
    });
  });

  const values = [3.7, -12.25, 0, 1500.3, 0.0062, -7777.7, 42.42, 0];
  test.each([
    ["log", logMapping],
    ["linear", linearMapping],
    ["quadratic", quadraticMapping],
    ["cubic", cubicMapping],
  ] as const)("round-trips the %s mapping on every store", (_, mapping) => {
    for (const store of [
      denseStore(),
      sparseStore(),
      collapsingLowestStore(2048),
      collapsingHighestStore(2048),
    ]) {
      const sketch = DDSketch.from(values, 0.01, { mapping, store });
      const back = fromProtobuf(toProtobuf(sketch), { store });
      expect(back.mapping.kind).toBe(sketch.mapping.kind);
      expect(back.mapping.gamma).toBe(sketch.mapping.gamma);
      expect(binsOf(back)).toEqual(binsOf(sketch));
    }
  });
});

// A minimal encoder of its own, so these messages are built independently of
// the code under test.
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
};
const f64 = (x: number): number[] => [
  ...new Uint8Array(Float64Array.of(x).buffer),
];
const zigzag = (n: number): number => ((n << 1) ^ (n >> 31)) >>> 0;
const field = (n: number, wire: number, payload: number[]): number[] =>
  wire === 2
    ? [...varint(n * 8 + 2), ...varint(payload.length), ...payload]
    : [...varint(n * 8 + wire), ...payload];
const mappingOf = (gamma: number, interpolation = 0): number[] =>
  field(1, 2, [
    ...field(1, 1, f64(gamma)),
    ...(interpolation ? field(3, 0, varint(interpolation)) : []),
  ]);
const binAt = (index: number, count: number): number[] =>
  field(
    2,
    2,
    field(1, 2, [
      ...field(1, 0, varint(zigzag(index))),
      ...field(2, 1, f64(count)),
    ]),
  );
const decode = (bytes: number[]): DDSketch =>
  fromProtobuf(Uint8Array.from(bytes));

// The writer sizes the message before filling it, so a field whose varint
// takes more than one byte, or a run starting below index 0, must be counted
// exactly: a miscount leaves trailing zeros the reader rejects, or drops bytes.
test.each([denseStore(), sparseStore()])(
  "a $kind store with wide indices and multi-byte varints round-trips",
  (store) => {
    const sketch = DDSketch.from(
      [1e-5, 3e-3, 0.5, 2, 7e3, 4e6, -1e-4, -9, -2e5, 0, 0],
      0.001,
      { store },
    );
    const back = fromProtobuf(toProtobuf(sketch), { store });
    expect(binsOf(back)).toEqual(binsOf(sketch));
  },
);

// What decoding promises: the sketch adding each bin's value, in the order the
// message lists the bins, would hold, its sum, min and max included.
function addedBins(
  mapping: IndexMapping,
  store: StoreFactory,
  positive: number[][],
  negative: number[][],
  zeroCount: number,
): DDSketch {
  const sketch = DDSketch.create(mapping.relativeAccuracy, {
    mapping: () => mapping,
    store,
  });
  for (const [index = 0, count = 0] of positive) {
    sketch.add(mapping.value(index), count);
  }
  for (const [index = 0, count = 0] of negative) {
    sketch.add(-mapping.value(index), count);
  }
  if (zeroCount > 0) sketch.add(0, zeroCount);
  return sketch;
}

describe("a decoded sketch is the one adding its bins builds", () => {
  test.each(cases)("for sketches-go's $name message", (c) => {
    const mapping = mappingWithGamma(
      KINDS[c.interpolation] ?? "log",
      c.gamma,
      c.indexOffset,
    );
    const store = collapsingLowestStore(4096);
    expect(
      fromProtobuf(fromBase64(c.message)).equals(
        addedBins(mapping, store, c.positive, c.negative, c.zeroCount),
      ),
    ).toBe(true);
  });

  test("for random sketches on every store", () => {
    const stores = [
      denseStore(),
      sparseStore(),
      collapsingLowestStore(16),
      collapsingHighestStore(16),
    ];
    const next = rng(47);
    for (let t = 0; t < 200; t++) {
      const store = stores[t % stores.length] ?? denseStore();
      const values = Array.from({ length: Math.floor(next() * 50) }, () => {
        const r = next();
        if (r < 0.1) return 0;
        const magnitude = 10 ** (next() * 8 - 4);
        return r < 0.4 ? -magnitude : magnitude;
      });
      const sketch = DDSketch.from(values, 0.01, { store });
      const list = (sign: "positive" | "negative"): number[][] => {
        const out: number[][] = [];
        sketchBins(sketch)[sign].forEach((index, count) =>
          out.push([index, count]),
        );
        return out;
      };
      const want = addedBins(
        sketch.mapping,
        store,
        list("positive"),
        list("negative"),
        sketchBins(sketch).zeroCount,
      );
      expect(fromProtobuf(toProtobuf(sketch), { store }).equals(want)).toBe(
        true,
      );
    }
  });
});

// The extreme bins' values can fall just outside the indexable range: decoded
// through add, the top bin threw and the bottom one was counted as zero.
test.each([
  ["bitwise", bitwiseMapping(0.01)],
  ["log", logMapping(0.01)],
  ["linear", linearMapping(0.01)],
  ["quadratic", quadraticMapping(0.01)],
  ["cubic", cubicMapping(0.01)],
] as const)("a %s message's extreme bins decode in place", (_, mapping) => {
  const lo = mapping.index(mapping.minIndexableValue);
  const hi = mapping.index(mapping.maxIndexableValue);
  const message = toProtobuf(
    sketchFromBins(
      mapping,
      sparseStore(),
      new Map([
        [lo, 1],
        [hi, 1],
      ]),
      new Map(),
      0,
    ),
  );
  const back = fromProtobuf(message, { store: sparseStore() });
  const bins: number[][] = [];
  sketchBins(back).positive.forEach((index, count) =>
    bins.push([index, count]),
  );
  expect([bins, sketchBins(back).zeroCount]).toEqual([
    [
      [lo, 1],
      [hi, 1],
    ],
    0,
  ]);
});

describe("decoding untrusted bytes", () => {
  // Two keys 2e8 apart are a valid message of a few dozen bytes; a dense
  // store would hold every slot between them, about 3.2 GB.
  const message = toProtobuf(
    DDSketch.from([1.000001 ** -1e8, 1.000001 ** 1e8], 5e-7, {
      mapping: logMapping,
      store: sparseStore(),
    }),
  );

  test("stays bounded at the default store", () => {
    expect(message.length).toBeLessThan(64);
    const { value, bytes } = allocatedBy(() => fromProtobuf(message));
    expect(bytes).toBeLessThan(1024 * 1024);
    expect(value.count).toBe(2);
  });

  test("takes a dense store when asked", () => {
    const small = toProtobuf(DDSketch.from([1, 2, 3], 0.01));
    expect(fromProtobuf(small, { store: denseStore() }).store.kind).toBe(
      "dense",
    );
  });
});

describe("a malformed message is rejected", () => {
  const gamma = logMapping(0.01).gamma;
  test.each<[string, number[]]>([
    ["a truncated varint", [0x80]],
    ["a varint longer than ten bytes", new Array<number>(11).fill(0xff)],
    ["a length past the end", [0x0a, 0x05, 0x09]],
    [
      "a known field with the wrong wire type",
      [...mappingOf(gamma), ...field(4, 0, [1])],
    ],
    ["an unknown interpolation", mappingOf(gamma, 4)],
    ["no mapping, so gamma 0", []],
    ["gamma of 1", mappingOf(1)],
    [
      "an indexOffset so large no value can be indexed",
      field(1, 2, [...field(1, 1, f64(gamma)), ...field(2, 1, f64(-6.8e38))]),
    ],
    ["a NaN gamma", mappingOf(Number.NaN)],
    ["a negative bin count", [...mappingOf(gamma), ...binAt(3, -1)]],
    ["a NaN bin count", [...mappingOf(gamma), ...binAt(3, Number.NaN)]],
    [
      "an index outside the mapping's range",
      [...mappingOf(gamma), ...binAt(2 ** 30, 1)],
    ],
    [
      "a group, which proto3 does not use",
      [...mappingOf(gamma), ...varint(15 * 8 + 3)],
    ],
  ])("%s", (_, bytes) => {
    expect(() => decode(bytes)).toThrow(SerializationError);
  });
});

test("fields this codec does not know are skipped, of every wire type", () => {
  const base = fromBase64(cases[0]?.message ?? "");
  const unknown = [
    ...field(15, 0, varint(300)),
    ...field(15, 1, f64(1.5)),
    ...field(15, 2, [0xaa, 0xbb]),
    ...field(15, 5, [1, 2, 3, 4]),
  ];
  expect(binsOf(decode([...base, ...unknown]))).toEqual(
    binsOf(fromProtobuf(base)),
  );
});

test("a QUADRATIC mapping, which sketches-go lacks, decodes", () => {
  const sketch = decode([
    ...mappingOf(quadraticMapping(0.01).gamma, 2),
    ...binAt(5, 2),
  ]);
  expect(sketch.mapping.kind).toBe("quadratic");
  expect(sketch.count).toBe(2);
});

describe("the shapes a valid message can take", () => {
  const gamma = logMapping(0.01).gamma;

  test("unknown fields inside the mapping, a store and a map entry are skipped", () => {
    const plain = decode([...mappingOf(gamma), ...binAt(3, 2)]);
    const padded = decode([
      ...field(1, 2, [...field(1, 1, f64(gamma)), ...field(9, 0, [7])]),
      ...field(2, 2, [
        ...field(1, 2, [
          ...field(1, 0, varint(zigzag(3))),
          ...field(2, 1, f64(2)),
          ...field(9, 0, [7]),
        ]),
        ...field(9, 5, [1, 2, 3, 4]),
      ]),
    ]);
    expect(binsOf(padded)).toEqual(binsOf(plain));
  });

  test("contiguous counts unpacked, one per field, read as packed ones do", () => {
    const packed = decode([
      ...mappingOf(gamma),
      ...field(2, 2, [
        ...field(2, 2, [...f64(1), ...f64(0), ...f64(4)]),
        ...field(3, 0, varint(zigzag(-2))),
      ]),
    ]);
    const unpacked = decode([
      ...mappingOf(gamma),
      ...field(2, 2, [
        ...field(2, 1, f64(1)),
        ...field(2, 1, f64(0)),
        ...field(2, 1, f64(4)),
        ...field(3, 0, varint(zigzag(-2))),
      ]),
    ]);
    expect(binsOf(unpacked)).toEqual(binsOf(packed));
    expect(binsOf(packed).positive).toEqual([
      [-2, 1],
      [0, 4],
    ]);
  });

  test("a map entry with a zero count adds nothing", () => {
    expect(
      binsOf(decode([...mappingOf(gamma), ...binAt(3, 0)])).positive,
    ).toEqual([]);
  });

  test("a negative zeroCount is rejected", () => {
    expect(() =>
      decode([...mappingOf(gamma), ...field(4, 1, f64(-1))]),
    ).toThrow(SerializationError);
  });
});

// A -0 offset would be written into the frame, which its reader refuses as a
// second encoding of 0 (#299), so the decoder reads it as 0.
test.each([
  ["log", 0],
  ["linear", 1],
])("a %s mapping's -0 indexOffset decodes as 0", (_, interpolation) => {
  const gamma = logMapping(0.01).gamma;
  const sketch = decode([
    ...field(1, 2, [
      ...field(1, 1, f64(gamma)),
      ...field(2, 1, f64(-0)),
      ...(interpolation ? field(3, 0, varint(interpolation)) : []),
    ]),
    ...binAt(3, 1),
  ]);
  expect(Object.is(sketch.mapping.indexOffset, 0)).toBe(true);
  expect(DDSketch.fromBytes(sketch.toBytes()).equals(sketch)).toBe(true);
});
