import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { MinHashLSH } from "../../src/minhash/lsh.js";
import { MinHash } from "../../src/minhash/minhash.js";
import { lshSizing } from "../../src/minhash/sizing.js";

const keys = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

function sketchOf(items: readonly string[], k = 128, seed = 0): MinHash {
  const sketch = new MinHash({ k, seed });
  for (const item of items) sketch.add(item);
  return sketch;
}

function filled(): MinHashLSH<string> {
  const lsh = new MinHashLSH<string>({ threshold: 0.5 });
  lsh.insert("a", sketchOf(keys("s", 200)));
  lsh.insert("b", sketchOf(keys("s", 200)));
  lsh.insert("c", sketchOf(keys("d", 200)));
  return lsh;
}

describe("construction", () => {
  test("defaults to 128 slots, seed 0, and the balanced split", () => {
    const lsh = new MinHashLSH({ threshold: 0.5 });
    expect(lsh.bands).toBe(25);
    expect(lsh.rows).toBe(5);
    expect(lsh.threshold).toBe(0.5);
    expect(lsh.k).toBe(128);
    expect(lsh.seed).toBe(0);
    expect(lsh.size).toBe(0);
  });

  test("takes its split from lshSizing", () => {
    const lsh = new MinHashLSH({ threshold: 0.7, k: 256, weights: [0.3, 0.7] });
    const { bands, rows } = lshSizing(0.7, 256, [0.3, 0.7]);
    expect(lsh.bands).toBe(bands);
    expect(lsh.rows).toBe(rows);
  });

  test("rejects a threshold outside (0, 1) and a seed outside u32", () => {
    expect(() => new MinHashLSH({ threshold: 1 })).toThrow(ParamError);
    expect(() => new MinHashLSH({ threshold: 0.5, seed: -1 })).toThrow(
      ParamError,
    );
  });
});

describe("insert and query", () => {
  test("returns every key sharing a band, each once", () => {
    const lsh = filled();
    expect(lsh.query(sketchOf(keys("s", 200))).sort()).toEqual(["a", "b"]);
  });

  test("an unrelated query finds nothing", () => {
    expect(filled().query(sketchOf(keys("fresh", 200)))).toEqual([]);
  });

  test("reports what it holds", () => {
    const lsh = filled();
    expect(lsh.has("a")).toBe(true);
    expect(lsh.has("z")).toBe(false);
    expect(lsh.size).toBe(3);
  });

  test("refuses a duplicate key", () => {
    expect(() => {
      filled().insert("a", sketchOf(["x"]));
    }).toThrow(ParamError);
  });

  test.each<[string, MinHash]>([
    ["k", sketchOf(["x"], 64)],
    ["seed", sketchOf(["x"], 128, 1)],
  ])("refuses a sketch with a different %s", (_, sketch) => {
    const lsh = filled();
    expect(() => {
      lsh.insert("x", sketch);
    }).toThrow(ParamError);
    expect(() => lsh.query(sketch)).toThrow(ParamError);
  });
});

describe("remove", () => {
  test("unfiles a key from every band", () => {
    const lsh = filled();
    expect(lsh.remove("a")).toBe(true);
    expect(lsh.has("a")).toBe(false);
    expect(lsh.size).toBe(2);
    expect(lsh.query(sketchOf(keys("s", 200)))).toEqual(["b"]);
  });

  test("reports a key that was not there, and lets a removed key back in", () => {
    const lsh = filled();
    lsh.remove("a");
    expect(lsh.remove("a")).toBe(false);
    lsh.insert("a", sketchOf(keys("s", 200)));
    expect(lsh.query(sketchOf(keys("s", 200))).sort()).toEqual(["a", "b"]);
  });

  // Near-duplicates share buckets by design, so a crowded bucket must not
  // make each removal scan it. The same removals are timed in two shapes, every
  // key in one bucket per band and every key in its own, rather than against
  // the wall clock: load slows both alike, while a scan shows as two orders of
  // magnitude (a ratio of about 58 at 10k, against under 0.5). Each shape keeps
  // its fastest of 3.
  test("stays constant per band when every key shares the same buckets", () => {
    const N = 10_000;
    const crowded = sketchOf(keys("s", 200));
    const spread = Array.from({ length: N }, (_, i) =>
      sketchOf([`u:${String(i)}`]),
    );
    const removal = (sketch: (i: number) => MinHash): number => {
      let fastest = Infinity;
      for (let run = 0; run < 3; run++) {
        const lsh = new MinHashLSH<number>({ threshold: 0.5 });
        for (let i = 0; i < N; i++) lsh.insert(i, sketch(i));
        const start = performance.now();
        for (let i = 0; i < N; i++) lsh.remove(i);
        fastest = Math.min(fastest, performance.now() - start);
        expect(lsh.size).toBe(0);
        expect(lsh.query(sketch(0))).toEqual([]);
      }
      return fastest;
    };

    const ratio = removal(() => crowded) / removal((i) => spread[i] ?? crowded);

    expect(ratio).toBeLessThan(4);
  });
});
