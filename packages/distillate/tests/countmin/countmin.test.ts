import fc from "fast-check";
import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import { ParamError } from "../../src/core/params.js";
import {
  CountMinOverflowError,
  CountMinSketch,
  type CountMinParams,
} from "../../src/countmin/countmin.js";
import { sampleStrings } from "../helpers/fpr.js";

test("a sketch reports the geometry it was built with", () => {
  const s = new CountMinSketch({ width: 100, depth: 4 });

  expect(s.width).toBe(100);
  expect(s.depth).toBe(4);
  expect(s.seed).toBe(0);
});

test("a seed passed to the constructor is kept", () => {
  expect(new CountMinSketch({ width: 100, depth: 4, seed: 7 }).seed).toBe(7);
});

test.each<[string, Partial<CountMinParams>]>([
  ["width 0", { width: 0 }],
  ["width 1.5", { width: 1.5 }],
  ["width 2^32", { width: 2 ** 32 }],
  ["depth 0", { depth: 0 }],
  ["depth 1.5", { depth: 1.5 }],
  ["depth 2^32", { depth: 2 ** 32 }],
  ["seed -1", { seed: -1 }],
  ["seed 2^32", { seed: 2 ** 32 }],
  // Counter positions are 32-bit offsets into one flat array, like BloomFilter's m.
  ["width * depth past 2^32 - 1", { width: 2 ** 31, depth: 3 }],
])("%s is rejected with ParamError", (_, bad) => {
  expect(() => new CountMinSketch({ width: 100, depth: 4, ...bad })).toThrow(
    ParamError,
  );
});

test("create sizes the sketch from epsilon and delta", () => {
  const s = CountMinSketch.create(0.001, 0.001);

  expect(s.width).toBe(2719);
  expect(s.depth).toBe(7);
  expect(s.seed).toBe(0);
});

test("a seed passed to create is kept", () => {
  expect(CountMinSketch.create(0.01, 0.01, { seed: 7 }).seed).toBe(7);
});

test("create rejects non-probabilities", () => {
  expect(() => CountMinSketch.create(0, 0.01)).toThrow(ParamError);
  expect(() => CountMinSketch.create(0.01, 1)).toThrow(ParamError);
});

test("a key counts zero until it is added", () => {
  expect(CountMinSketch.create(0.01, 0.01).count("a")).toBe(0);
});

test("add records one occurrence, or the count it is given", () => {
  const s = CountMinSketch.create(0.01, 0.01);
  s.add("a");

  expect(s.count("a")).toBe(1);

  s.add("a", 3);

  expect(s.count("a")).toBe(4);
});

// The sketch's hard invariant: it may overestimate, never underestimate.
test("every key counts at least as often as it was added", () => {
  fc.assert(
    fc.property(fc.array(fc.string(), { maxLength: 200 }), (keys) => {
      const s = CountMinSketch.create(0.01, 0.01);
      const truth = new Map<string, number>();
      for (const k of keys) {
        s.add(k);
        truth.set(k, (truth.get(k) ?? 0) + 1);
      }
      return [...truth].every(([k, n]) => s.count(k) >= n);
    }),
  );
});

test("total is the sum of every count recorded", () => {
  const s = CountMinSketch.create(0.01, 0.01);

  expect(s.total).toBe(0);

  s.add("a");
  s.add("b", 5);

  expect(s.total).toBe(6);
});

test("total tracks the counts whatever keys they land on", () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(fc.string(), fc.integer({ min: 1, max: 1000 })), {
        maxLength: 200,
      }),
      (entries) => {
        const s = CountMinSketch.create(0.01, 0.01);
        for (const [key, n] of entries) s.add(key, n);
        return s.total === entries.reduce((sum, [, n]) => sum + n, 0);
      },
    ),
  );
});

// The geometry is solved with a ceil, so the sketch implements a slightly
// tighter contract than the one asked for. It reports what it implements.
test("a sketch reports the contract its geometry implements", () => {
  const s = CountMinSketch.create(0.001, 0.001);

  expect(s.epsilon).toBe(Math.E / 2719);
  expect(s.delta).toBe(Math.exp(-7));
  expect(s.epsilon).toBeLessThan(0.001);
  expect(s.delta).toBeLessThan(0.001);
});

test("error is the additive bound at the current total", () => {
  const s = CountMinSketch.create(0.001, 0.001);

  expect(s.error()).toBe(0);

  s.add("a", 1000);

  expect(s.error()).toBe(s.epsilon * 1000);
});

// A count below 1 would let an estimate fall under the true count, which is
// the one thing the sketch promises cannot happen.
test.each([0, -1, 1.5, Number.NaN])(
  "add with a count of %s is rejected with ParamError",
  (bad) => {
    const s = CountMinSketch.create(0.01, 0.01);

    expect(() => {
      s.add("a", bad);
    }).toThrow(ParamError);
    expect(s.count("a")).toBe(0);
    expect(s.total).toBe(0);
  },
);

// A saturating counter would underestimate from then on, silently. Width 8
// keeps most columns untouched, so the snapshot is evidence that nothing moved
// rather than a comparison of one value with itself.
test("an add that would overflow a counter throws and changes nothing", () => {
  const s = new CountMinSketch({ width: 8, depth: 2 });
  const probes = sampleStrings(31, 200);
  s.add("a", 0xffffffff);

  expect(s.count("a")).toBe(0xffffffff);

  const snapshot = probes.map((p) => s.count(p));

  expect(() => {
    s.add("a", 1);
  }).toThrow(CountMinOverflowError);
  expect(probes.map((p) => s.count(p))).toEqual(snapshot);
  expect(s.count("a")).toBe(0xffffffff);
  expect(s.total).toBe(0xffffffff);
});

// The opposite of CuckooFilter.from, which drops repeats because a repeat
// costs it a slot. Here a repeat is the measurement.
test("from counts repeated keys rather than deduping them", () => {
  const s = CountMinSketch.from(["a", "a", "b"], 0.01, 0.01);

  expect(s.count("a")).toBe(2);
  expect(s.count("b")).toBe(1);
  expect(s.total).toBe(3);
});

test("from with no keys gives an empty sketch at the target geometry", () => {
  const s = CountMinSketch.from([], 0.001, 0.001);

  expect(s.total).toBe(0);
  expect(s.width).toBe(2719);
  expect(s.depth).toBe(7);
});

test("a seed passed to from is kept", () => {
  expect(CountMinSketch.from(["a"], 0.01, 0.01, { seed: 7 }).seed).toBe(7);
});

// A counter caps at 2^32 - 1, but `total` is the sum across a row, so a wide
// enough sketch can carry it past 2^53 while every counter stays legal. Past
// that point `total` silently loses precision and `error()` drifts with it,
// and worse, `fromBytes` rejects the row sum, so the writer would be able to
// produce a frame its own reader refuses. Reached here by loading a frame
// rather than by counting to it, which takes a couple of million adds.
const nearSafeLimit = (): CountMinSketch => {
  const width = 2 ** 22;
  const each = 2 ** 31 - 1;
  const frame = new CountMinSketch({ width, depth: 1 }).toBytes();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  for (let i = 0; i < width; i++) view.setUint32(32 + 4 * i, each, true);
  view.setUint32(
    frame.length - 4,
    crc32(frame.subarray(0, frame.length - 4)),
    true,
  );
  return CountMinSketch.fromBytes(frame);
};

test("an add that would carry the total past the safe integer range throws", () => {
  const s = nearSafeLimit();
  const room = Number.MAX_SAFE_INTEGER - s.total;

  expect(s.total).toBe(2 ** 53 - 2 ** 22);
  expect(room).toBeGreaterThan(0);

  // One more than the room left. Every counter has headroom to spare, so a
  // counter guard cannot be what rejects this.
  expect(() => {
    s.add("a", room + 1);
  }).toThrow(CountMinOverflowError);
  expect(s.total).toBe(2 ** 53 - 2 ** 22);

  // The frame still loads, which is the property the guard protects.
  expect(CountMinSketch.fromBytes(s.toBytes()).total).toBe(s.total);
});

test("a union that would carry the total past the safe integer range throws", () => {
  const s = nearSafeLimit();

  // Counters sum to 2^32 - 2 here, inside the per-counter limit, so this is
  // the total overflowing on its own rather than a counter dragging it over.
  expect(() => s.union(s)).toThrow(CountMinOverflowError);
});
