import { expect, test } from "vitest";

import { lshRows, minHashRows, similarityAdapters } from "../src/minhash.js";

const items = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

test("similarity adapters estimate at equal k from a shared family", () => {
  expect(similarityAdapters.map((a) => a.name)).toEqual([
    "distillate/minhash",
    "bloom-filters",
    "minhash",
  ]);

  for (const adapter of similarityAdapters) {
    const create = adapter.family(128);
    const sketchOf = (keys: string[]) => {
      const s = create();
      for (const key of keys) s.add(key);
      return s;
    };

    const same = items("same", 500);
    const a = sketchOf(same);
    expect(a.k, adapter.name).toBe(128);
    expect(a.jaccard(sketchOf(same)), adapter.name).toBe(1);
    expect(
      sketchOf(items("left", 2000)).jaccard(sketchOf(items("right", 2000))),
      adapter.name,
    ).toBeLessThan(0.15);
    expect(a.bytes(), adapter.name).toBeGreaterThan(0);
  }
});

test("minhash rows measure add rate, Jaccard error and size", () => {
  const rows = minHashRows([1_000]);

  expect(rows.map((r) => r.name)).toEqual([
    "distillate/minhash",
    "bloom-filters",
    "minhash",
  ]);
  for (const r of rows) {
    expect(r.items, r.name).toBe(1_000);
    expect(Number.isFinite(r.addOpsPerSec) && r.addOpsPerSec > 0, r.name).toBe(
      true,
    );
    expect(r.meanAbsError, r.name).toBeLessThanOrEqual(r.maxAbsError);
    expect(r.maxAbsError, r.name).toBeLessThanOrEqual(1);
    expect(r.bytes, r.name).toBeGreaterThan(0);
  }
});

test("lsh rows measure index speed and recall where a library has an index", () => {
  const rows = lshRows(1_000);

  // bloom-filters has no LSH index, so it has no row.
  expect(rows.map((r) => r.name)).toEqual(["distillate/minhash", "minhash"]);
  for (const r of rows) {
    expect(r.docs, r.name).toBe(1_000);
    expect(r.thrown, r.name).toBeGreaterThanOrEqual(0);
    expect(r.thrown, r.name).toBeLessThanOrEqual(2 * r.docs);
    expect(Number.isFinite(r.insertOpsPerSec) && r.insertOpsPerSec > 0).toBe(
      true,
    );
  }

  const ours = rows[0];
  expect(ours?.recall).toBeGreaterThanOrEqual(0.9);
  expect(ours?.thrown).toBe(0);
  expect(Number.isFinite(ours?.queryOpsPerSec)).toBe(true);
});
