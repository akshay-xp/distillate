import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import {
  TopK,
  TopKOverflowError,
  TopKParamMismatchError,
} from "../../src/topk/topk.js";
import { truthOf, zipfStream } from "../helpers/frequency.js";
import { expectOneSided } from "../helpers/topk.js";

// A differing seed matters as much as a differing capacity: the same key would
// hash elsewhere, and the error naming both values says which side to rebuild.
test.each<[string, TopK, RegExp]>([
  ["capacity", new TopK({ capacity: 32 }), /capacity 16 and 32/],
  ["seed", new TopK({ capacity: 16, seed: 7 }), /seed 0 and 7/],
])("a union across a differing %s is refused", (_, other, message) => {
  const a = new TopK({ capacity: 16 });

  expect(() => a.union(other)).toThrow(TopKParamMismatchError);
  expect(() => a.union(other)).toThrow(message);
});

test("a union sums each key's count, the offsets and the totals", () => {
  const a = new TopK({ capacity: 64 });
  a.add("x", 3);
  a.add("y", 2);
  const b = new TopK({ capacity: 64 });
  b.add("x", 1);
  b.add("z", 4);
  const beforeA = a.toBytes();
  const beforeB = b.toBytes();

  const u = a.union(b);

  expect(u.count("x")).toBe(4);
  expect(u.count("y")).toBe(2);
  expect(u.count("z")).toBe(4);
  expect(u.total).toBe(10);
  expect(u.error()).toBe(0);
  expect(a.toBytes()).toEqual(beforeA);
  expect(b.toBytes()).toEqual(beforeB);
});

test("a union with an empty sketch is the other side", () => {
  const a = new TopK({ capacity: 64 });
  a.add("x", 3);
  a.add("y", 2);
  const empty = new TopK({ capacity: 64 });

  expect(a.union(empty).toBytes()).toEqual(a.toBytes());
  expect(empty.union(a).toBytes()).toEqual(a.toBytes());
});

const heavy = zipfStream(71, 2_000, 20_000, 1.1);
const flatter = zipfStream(72, 2_000, 20_000, 0.8);
const small = ["key:0", "key:0", "key:5"];

const fed = (stream: string[]): TopK => {
  const s = new TopK({ capacity: 64 });
  for (const key of stream) s.add(key);
  return s;
};

test.each<[string, string[], string[]]>([
  ["both sides", heavy, flatter],
  ["the left side only", heavy, small],
  ["the right side only", small, flatter],
])(
  "a union after a purge on %s holds the guarantee in either order",
  (_, streamA, streamB) => {
    const a = fed(streamA);
    const b = fed(streamB);
    for (const [s, stream] of [
      [a, streamA],
      [b, streamB],
    ] as const) {
      if (stream !== small) expect(s.error()).toBeGreaterThan(0);
    }
    const truth = truthOf([...streamA, ...streamB]);

    for (const u of [a.union(b), b.union(a)]) {
      expectOneSided(u, truth);
      expect(u.total).toBe(a.total + b.total);
      expect(u.error()).toBeGreaterThanOrEqual(a.error() + b.error());
    }
  },
);

// Without the check a Uint32Array write wraps: 2^32 stores as 0, and the
// merged key would read as absent, below its true count.
test("a union that would wrap a stored count is refused", () => {
  const a = new TopK({ capacity: 16 });
  a.add("k", 2 ** 32 - 1);
  const b = new TopK({ capacity: 16 });
  b.add("k", 1);
  const beforeA = a.toBytes();
  const beforeB = b.toBytes();

  expect(() => a.union(b)).toThrow(TopKOverflowError);
  expect(a.toBytes()).toEqual(beforeA);
  expect(b.toBytes()).toEqual(beforeB);
});

// Reaching the safe-integer edge by adding takes 2^21 maximal adds, so the
// total is written into a frame directly instead.
const withTotal = (sketch: TopK, total: number): TopK => {
  const frame = sketch.toBytes();
  const view = new DataView(frame.buffer);
  view.setFloat64(32, total, true);
  view.setUint32(
    frame.length - 4,
    crc32(frame.subarray(0, frame.length - 4)),
    true,
  );
  return TopK.fromBytes(frame);
};

test("a union that would carry the total past the safe integer range is refused", () => {
  const a = withTotal(new TopK({ capacity: 16 }), Number.MAX_SAFE_INTEGER - 5);
  const b = new TopK({ capacity: 16 });
  b.add("k", 6);

  expect(() => a.union(b)).toThrow(TopKOverflowError);
});

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bracket = (s: TopK): [string, number, number][] =>
  s.top(s.capacity).map((e) => [decode(e.key), e.count, e.lowerBound]);

// The documented departure from Count-Min, whose union is byte-exact. Here B
// alone purges to empty, so the union keeps everything A held and charges B's
// purge to the offset; one sketch fed both streams purges A's entries along
// with B's instead. Both answers are correct, and they are not the same.
test("a union is not the sketch the combined stream would have produced", () => {
  const streamA = ["x", "x", "x", "y", "y", "z"];
  const streamB = ["p", "q", "x", "r"];
  const a = new TopK({ capacity: 4 });
  for (const key of streamA) a.add(key);
  const b = new TopK({ capacity: 4 });
  for (const key of streamB) b.add(key);
  const both = new TopK({ capacity: 4 });
  for (const key of [...streamA, ...streamB]) both.add(key);

  const u = a.union(b);

  expect(u.error()).toBe(1);
  expect(bracket(u)).toEqual([
    ["x", 4, 3],
    ["y", 3, 2],
    ["z", 2, 1],
  ]);
  expect(both.error()).toBe(2);
  expect(bracket(both)).toEqual([
    ["x", 4, 2],
    ["q", 3, 1],
    ["r", 3, 1],
  ]);

  expect(u.equals(both)).toBe(false);
  const truth = truthOf([...streamA, ...streamB]);
  expectOneSided(u, truth);
  expectOneSided(both, truth);
});
