import { expect, test } from "vitest";

import { hash32x2Into } from "../../src/core/hasher.js";
import { ParamError } from "../../src/core/params.js";
import { topKSizing } from "../../src/topk/sizing.js";
import { TopK, TopKOverflowError } from "../../src/topk/topk.js";

test("create builds a sketch with the capacity the sizing solved for", () => {
  const sketch = TopK.create(0.01);

  expect(sketch.capacity).toBe(512);
  expect(sketch.capacity).toBe(topKSizing(0.01).capacity);
});

test("the seed defaults to 0 and is carried from options", () => {
  expect(TopK.create(0.01).seed).toBe(0);
  expect(TopK.create(0.01, { seed: 7 }).seed).toBe(7);
});

test("epsilon reports what the purge width delivers, not what was asked", () => {
  const sketch = TopK.create(0.01);

  expect(sketch.epsilon).toBe(1 / 193);
  expect(sketch.epsilon).toBeLessThanOrEqual(0.01);
});

test("the constructor refuses a capacity it cannot hold", () => {
  expect(() => new TopK({ capacity: 100 })).toThrow(ParamError);
  expect(() => new TopK({ capacity: 2 })).toThrow(ParamError);
  expect(() => new TopK({ capacity: 2 ** 25 })).toThrow(ParamError);
});

test("add records occurrences and count reads them back", () => {
  const sketch = TopK.create(0.01);

  expect(sketch.total).toBe(0);
  expect(sketch.count("alice")).toBe(0);

  sketch.add("alice");
  expect(sketch.count("alice")).toBe(1);

  sketch.add("alice");
  sketch.add("alice");
  sketch.add("alice");
  expect(sketch.count("alice")).toBe(4);

  sketch.add("alice", 5);
  expect(sketch.count("alice")).toBe(9);
  expect(sketch.total).toBe(9);
});

test("a key is one entry however it is spelled", () => {
  const sketch = TopK.create(0.01);
  const bytes = new TextEncoder().encode("alice");

  sketch.add("alice", 9);

  expect(sketch.count(bytes)).toBe(9);
  expect(sketch.count(bytes.buffer)).toBe(9);

  sketch.add(bytes);
  expect(sketch.count("alice")).toBe(10);
  expect(sketch.total).toBe(10);
});

test("a count that could produce an underestimate is refused", () => {
  const sketch = TopK.create(0.01);

  for (const bad of [0, -1, 1.5, Number.NaN]) {
    expect(() => {
      sketch.add("a", bad);
    }).toThrow(ParamError);
  }

  // The refusals must leave nothing behind, not even an occupied slot.
  expect(sketch.count("a")).toBe(0);
  expect(sketch.total).toBe(0);

  sketch.add("a", 2);
  expect(sketch.count("a")).toBe(2);
});

// The first two keys landing in the same bucket of a 16-slot map, found rather
// than hardcoded so the pair survives a change of hash seed or key shape.
const collidingPair = (capacity: number): [string, string] => {
  const words = new Uint32Array(2);
  const seen = new Map<number, string>();
  for (let i = 0; i < 1000; i++) {
    const key = `key:${String(i)}`;
    hash32x2Into(key, 0, words);
    const bucket = (words[0] ?? 0) & (capacity - 1);
    const first = seen.get(bucket);
    if (first !== undefined) return [first, key];
    seen.set(bucket, key);
  }
  throw new Error("no colliding pair found");
};

test("an add that would wrap a stored count is refused and changes nothing", () => {
  const fresh = new TopK({ capacity: 16 });
  expect(() => {
    fresh.add("a", 2 ** 32);
  }).toThrow(TopKOverflowError);
  // No orphan entry: a refused add must not have claimed a slot.
  expect(fresh.count("a")).toBe(0);
  expect(fresh.top(1)).toEqual([]);
  expect(fresh.total).toBe(0);

  const full = new TopK({ capacity: 16 });
  full.add("a", 2 ** 32 - 1);
  expect(() => {
    full.add("a", 1);
  }).toThrow(TopKOverflowError);
  expect(full.count("a")).toBe(2 ** 32 - 1);
  expect(full.total).toBe(2 ** 32 - 1);
  expect(full.top(5)).toHaveLength(1);
});

test("two keys sharing a bucket keep their own counts", () => {
  const sketch = new TopK({ capacity: 16 });
  const [first, second] = collidingPair(16);

  sketch.add(first, 3);
  sketch.add(second, 5);

  expect(sketch.count(first)).toBe(3);
  expect(sketch.count(second)).toBe(5);
  expect(sketch.count("never-added")).toBe(0);
  expect(sketch.total).toBe(8);
});

test("error is 0 until the load limit is passed", () => {
  const sketch = new TopK({ capacity: 16 });

  expect(sketch.error()).toBe(0);
  for (let i = 0; i < 12; i++) sketch.add(`key:${String(i)}`);
  expect(sketch.error()).toBe(0);
});

test("passing the load limit purges the median away", () => {
  const sketch = new TopK({ capacity: 16 });

  // 13 distinct keys at one occurrence each: the median is 1, so every entry
  // reaches zero and the map empties.
  for (let i = 0; i < 13; i++) sketch.add(`key:${String(i)}`);

  expect(sketch.error()).toBe(1);
  expect(sketch.total).toBe(13);
  expect(sketch.count("key:0")).toBe(0);
});

test("a heavy key survives a purge with its count intact", () => {
  const sketch = new TopK({ capacity: 16 });

  sketch.add("heavy", 20);
  for (let i = 0; i < 12; i++) sketch.add(`key:${String(i)}`);

  // Median 1 drops the twelve singletons and takes 1 off heavy, which the
  // offset then gives back.
  expect(sketch.error()).toBe(1);
  expect(sketch.count("heavy")).toBe(20);
  expect(sketch.total).toBe(32);
});

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test("top returns the heaviest keys, as bytes, with their bounds", () => {
  const sketch = new TopK({ capacity: 16 });
  sketch.add("a", 5);
  sketch.add("b", 3);
  sketch.add("c", 1);

  const top2 = sketch.top(2);
  expect(top2).toHaveLength(2);
  expect(top2[0]?.key).toBeInstanceOf(Uint8Array);
  expect(decode(top2[0]?.key ?? new Uint8Array())).toBe("a");
  expect(top2[0]?.count).toBe(5);
  expect(top2[0]?.lowerBound).toBe(5);
  expect(decode(top2[1]?.key ?? new Uint8Array())).toBe("b");

  expect(sketch.top(10)).toHaveLength(3);
  expect(sketch.top(1)).toHaveLength(1);
});

test("top on an empty sketch is empty, and k must be a positive integer", () => {
  const sketch = new TopK({ capacity: 16 });

  expect(sketch.top(5)).toEqual([]);
  for (const bad of [0, -1, 1.5]) {
    expect(() => sketch.top(bad)).toThrow(ParamError);
  }
});

test("top breaks a tie by key bytes so the order never depends on insertion", () => {
  const sketch = new TopK({ capacity: 16 });
  sketch.add("b");
  sketch.add("a");

  expect(sketch.top(2).map((e) => decode(e.key))).toEqual(["a", "b"]);
});

test("a returned key is a copy, not a window into the arena", () => {
  const sketch = new TopK({ capacity: 16 });
  sketch.add("a", 5);

  const first = sketch.top(1)[0]?.key ?? new Uint8Array();
  first[0] = 0x7a;

  expect(decode(sketch.top(1)[0]?.key ?? new Uint8Array())).toBe("a");
});

test("from counts repeats rather than deduping them", () => {
  const sketch = TopK.from(["a", "a", "b"], 0.01);

  expect(sketch.count("a")).toBe(2);
  expect(sketch.count("b")).toBe(1);
  expect(sketch.total).toBe(3);
  expect(sketch.capacity).toBe(topKSizing(0.01).capacity);
});

test("from carries its options and takes an empty stream", () => {
  expect(TopK.from([], 0.01, { seed: 7 }).seed).toBe(7);
  expect(TopK.from([], 0.01).total).toBe(0);
  expect(TopK.from([], 0.01).top(1)).toEqual([]);
});
