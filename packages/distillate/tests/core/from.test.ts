import { expect, test } from "vitest";

import { BlockedBloomFilter } from "../../src/blocked/blocked.js";
import { BloomFilter } from "../../src/bloom/bloom.js";
import { CountMinSketch } from "../../src/countmin/countmin.js";
import { CuckooFilter } from "../../src/cuckoo/cuckoo.js";
import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import { BinaryFuse8, BinaryFuse16 } from "../../src/fuse/fuse.js";
import { HyperLogLog } from "../../src/hll/hll.js";
import { ScalableBloomFilter } from "../../src/scalable/scalable.js";
import { TopK } from "../../src/topk/topk.js";

// Builders take arrays by index and any other iterable by iteration, so each
// must build the same structure either way.

const keys = Array.from({ length: 500 }, (_, i) => `g:${String(i)}`);
const values = Array.from({ length: 500 }, (_, i) => i + 1);

function* once<T>(items: readonly T[]): Generator<T> {
  yield* items;
}

interface Same {
  equals(other: never): boolean;
}

const builders: [string, (items: Iterable<string>) => Same][] = [
  ["BloomFilter", (k) => BloomFilter.from(k, 0.01)],
  ["BlockedBloomFilter", (k) => BlockedBloomFilter.from(k, 0.01)],
  ["ScalableBloomFilter", (k) => ScalableBloomFilter.from(k, 0.01)],
  ["CountMinSketch", (k) => CountMinSketch.from(k, 0.01, 0.01)],
  ["HyperLogLog", (k) => HyperLogLog.from(k, 0.01)],
  ["TopK", (k) => TopK.from(k, 0.01)],
  ["CuckooFilter", (k) => CuckooFilter.from(k, 0.01)],
  ["BinaryFuse8", (k) => BinaryFuse8.from(k)],
  ["BinaryFuse16", (k) => BinaryFuse16.from(k)],
];

test.each(builders)(
  "%s.from builds the same from a generator as from an array",
  (_, build) => {
    expect(build(keys).equals(build(once(keys)) as never)).toBe(true);
  },
);

test("DDSketch.from builds the same from a generator as from an array", () => {
  expect(
    DDSketch.from(values, 0.01).equals(DDSketch.from(once(values), 0.01)),
  ).toBe(true);
});
