import { expect, test } from "vitest";

import { similarityAdapters } from "../src/minhash.js";

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
