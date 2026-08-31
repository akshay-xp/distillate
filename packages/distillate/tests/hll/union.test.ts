import fc from "fast-check";
import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { HyperLogLog } from "../../src/hll/hll.js";

const keys = (tag: string, n: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`${tag}:${String(i)}`);
  return out;
};

const sketchOf = (pool: readonly string[], p = 14, seed = 0): HyperLogLog => {
  const sketch = new HyperLogLog({ p, seed });
  for (const key of pool) sketch.add(key);
  return sketch;
};

// A sketch under the promotion threshold is sparse, one well over it is dense.
// At p=14 the sparse buffer holds 3072 entries, so 100 keys stay sparse and
// 5000 are long past promoted.
test("union of two sparse sketches holds both key sets", () => {
  const a = keys("a", 100);
  const b = keys("b", 100);
  const merged = sketchOf(a).union(sketchOf(b));

  expect(merged.equals(sketchOf([...a, ...b]))).toBe(true);
  expect(merged.count()).toBe(200);
});

test("union of two dense sketches holds both key sets", () => {
  const a = keys("a", 5000);
  const b = keys("b", 5000);
  const merged = sketchOf(a).union(sketchOf(b));

  expect(merged.equals(sketchOf([...a, ...b]))).toBe(true);
});

test("union pairs a sparse sketch with a dense one, either way round", () => {
  const a = keys("a", 100);
  const b = keys("b", 5000);
  const reference = sketchOf([...a, ...b]);

  expect(sketchOf(a).union(sketchOf(b)).equals(reference)).toBe(true);
  expect(sketchOf(b).union(sketchOf(a)).equals(reference)).toBe(true);
});

test("union with a subset changes nothing", () => {
  const a = keys("a", 5000);
  const merged = sketchOf(a).union(sketchOf(a.slice(0, 1000)));
  expect(merged.equals(sketchOf(a))).toBe(true);
});

test("union leaves both operands as they were", () => {
  const a = sketchOf(keys("a", 100));
  const b = sketchOf(keys("b", 5000));
  const aBefore = a.count();
  const bBefore = b.count();

  a.union(b);

  expect(a.count()).toBe(aBefore);
  expect(b.count()).toBe(bBefore);
  expect(a.p).toBe(14);
  expect(b.p).toBe(14);
  expect(a.equals(sketchOf(keys("a", 100)))).toBe(true);
  expect(b.equals(sketchOf(keys("b", 5000)))).toBe(true);
});

// Merging sketches of unequal precision takes the coarser one, matching
// BigQuery HLL++ and DataSketches. A finer sketch can always be folded down;
// the reverse would invent detail it never recorded.
test("union of unequal precisions folds to the coarser one", () => {
  const a = keys("a", 5000);
  const b = keys("b", 5000);
  const reference = sketchOf([...a, ...b], 10);

  const merged = sketchOf(a, 14).union(sketchOf(b, 10));
  expect(merged.p).toBe(10);
  expect(merged.equals(reference)).toBe(true);

  const reversed = sketchOf(b, 10).union(sketchOf(a, 14));
  expect(reversed.p).toBe(10);
  expect(reversed.equals(reference)).toBe(true);
});

// The sparse buffer is sized against the dense registers, so it shrinks with
// precision: 192 entries at p=10 against 3072 at p=14. Fifty keys a side stay
// inside that, so the merge stays sparse and keeps counting exactly.
test("folding a union carries sparse operands with it", () => {
  const a = keys("a", 50);
  const b = keys("b", 50);
  const merged = sketchOf(a, 14).union(sketchOf(b, 10));

  expect(merged.p).toBe(10);
  expect(merged.equals(sketchOf([...a, ...b], 10))).toBe(true);
  expect(merged.count()).toBe(100);
});

test("folding a union mixes representations across precisions", () => {
  const a = keys("a", 100);
  const b = keys("b", 5000);
  const reference = sketchOf([...a, ...b], 8);

  expect(sketchOf(a, 14).union(sketchOf(b, 8)).equals(reference)).toBe(true);
  expect(sketchOf(b, 8).union(sketchOf(a, 14)).equals(reference)).toBe(true);
});

// A fixed example can pass while the fold is wrong for precision gaps it does
// not happen to cover, so the fold is pinned over generated inputs instead.
// The generator is a seeded LCG, so a failure names a reproducible trial.
const lcg = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};

test("a union folds to the sketch the merged keys would have built", () => {
  const random = lcg(12_345);
  const precisions = [8, 10, 12, 14];
  const sizes = [20, 100, 900, 4000];

  for (let trial = 0; trial < 12; trial++) {
    const p1 = precisions[Math.floor(random() * precisions.length)] ?? 14;
    const p2 = precisions[Math.floor(random() * precisions.length)] ?? 14;
    const a = keys(`p${String(trial)}a`, sizes[trial % sizes.length] ?? 100);
    const b = keys(
      `p${String(trial)}b`,
      sizes[(trial + 2) % sizes.length] ?? 100,
    );

    const merged = sketchOf(a, p1).union(sketchOf(b, p2));
    const reference = sketchOf([...a, ...b], Math.min(p1, p2));

    expect({ trial, p: merged.p }).toEqual({ trial, p: Math.min(p1, p2) });
    expect({ trial, same: merged.equals(reference) }).toEqual({
      trial,
      same: true,
    });
  }
});

test("union is commutative", () => {
  const random = lcg(999);
  const precisions = [8, 10, 12, 14];

  for (let trial = 0; trial < 8; trial++) {
    const p1 = precisions[Math.floor(random() * precisions.length)] ?? 14;
    const p2 = precisions[Math.floor(random() * precisions.length)] ?? 14;
    const a = sketchOf(keys(`c${String(trial)}a`, 900), p1);
    const b = sketchOf(keys(`c${String(trial)}b`, 4000), p2);

    expect({ trial, same: a.union(b).equals(b.union(a)) }).toEqual({
      trial,
      same: true,
    });
  }
});

test("union is associative", () => {
  const random = lcg(4242);
  const precisions = [8, 10, 12, 14];

  for (let trial = 0; trial < 8; trial++) {
    const p1 = precisions[Math.floor(random() * precisions.length)] ?? 14;
    const p2 = precisions[Math.floor(random() * precisions.length)] ?? 14;
    const p3 = precisions[Math.floor(random() * precisions.length)] ?? 14;
    const a = sketchOf(keys(`s${String(trial)}a`, 100), p1);
    const b = sketchOf(keys(`s${String(trial)}b`, 900), p2);
    const c = sketchOf(keys(`s${String(trial)}c`, 4000), p3);

    const left = a.union(b).union(c);
    const right = a.union(b.union(c));
    expect({ trial, same: left.equals(right) }).toEqual({ trial, same: true });
  }
});

// Sketches seeded differently hash the same key to different registers, so
// merging them would silently produce a count belonging to neither.
test("union rejects a sketch built with a different seed", () => {
  const a = sketchOf(keys("a", 100));
  const b = sketchOf(keys("b", 100), 14, 7);
  expect(() => a.union(b)).toThrow(ParamError);
});

const keySet = fc.uniqueArray(fc.string(), { maxLength: 300 });
const precision = fc.integer({ min: 4, max: 14 });

// The strongest statement the merge can make, and the one that pins the fold:
// a union is not merely close to the sketch you would have built from both key
// sets, it is that sketch, register for register. Exact rather than tolerant
// because two sketches over the same keys at the same precision are identical.
test("a union is the sketch the combined keys would have built", () => {
  fc.assert(
    fc.property(keySet, keySet, precision, precision, (ka, kb, pa, pb) => {
      const merged = sketchOf(ka, pa).union(sketchOf(kb, pb));
      const direct = sketchOf([...new Set([...ka, ...kb])], Math.min(pa, pb));

      expect(merged.equals(direct)).toBe(true);
    }),
  );
});

// Each operand is rebuilt rather than reused: union compacts an operand's
// sparse buffer in place, so sharing one across both sides of an equality
// would be comparing a sketch against a version of itself it had already
// rearranged.
test("union is commutative at any precision pair", () => {
  fc.assert(
    fc.property(keySet, keySet, precision, precision, (ka, kb, pa, pb) => {
      expect(
        sketchOf(ka, pa)
          .union(sketchOf(kb, pb))
          .equals(sketchOf(kb, pb).union(sketchOf(ka, pa))),
      ).toBe(true);
    }),
  );
});

// The one law of the three that the fold can actually break: the two groupings
// reach the coarsest precision by different routes, one of them in two steps.
// Commutativity and idempotence fold symmetrically, so they survive a broken
// foldRho and cannot stand in for this.
test("union is associative at any precision triple", () => {
  fc.assert(
    fc.property(
      keySet,
      keySet,
      keySet,
      precision,
      precision,
      precision,
      (ka, kb, kc, pa, pb, pc) => {
        const left = sketchOf(ka, pa)
          .union(sketchOf(kb, pb))
          .union(sketchOf(kc, pc));
        const right = sketchOf(ka, pa).union(
          sketchOf(kb, pb).union(sketchOf(kc, pc)),
        );

        expect(left.equals(right)).toBe(true);
      },
    ),
  );
});

test("union with itself changes nothing at any precision", () => {
  fc.assert(
    fc.property(keySet, precision, (ka, pa) => {
      expect(
        sketchOf(ka, pa).union(sketchOf(ka, pa)).equals(sketchOf(ka, pa)),
      ).toBe(true);
    }),
  );
});

/** The encoding byte of a sketch's frame: 0 dense, 1 sparse. */
const encoding = (sketch: HyperLogLog): number => sketch.toBytes()[17] ?? -1;

// "Covers its inputs" is exact when stated as algebra rather than arithmetic:
// merging an operand back into a union that already holds it cannot change it.
//
// The count-level version is not an invariant. A union can promote to dense
// while its operands are still sparse and counting exactly, and a dense sketch
// estimates. fc found [[""], [" ", "!", "\"", "Q", "#"], 5, 5]: one key and
// five at p=5, where the buffer holds six, so the operands count exactly, 1 and
// 5, and their six-key union tips over and estimates 7, above the sum of both.
// Sweeping every size pair around the boundary for p in 4..9, the sum bound
// fails 195 times and even the lower bound fails 9 times in 26,946, while the
// covering statement below fails 0 times in 13,473.
test("a union covers each of its inputs", () => {
  fc.assert(
    fc.property(keySet, keySet, precision, precision, (ka, kb, pa, pb) => {
      const merged = sketchOf(ka, pa).union(sketchOf(kb, pb));

      expect(merged.union(sketchOf(ka, pa)).equals(merged)).toBe(true);
      expect(merged.union(sketchOf(kb, pb)).equals(merged)).toBe(true);
    }),
  );
});

// The count-level bound, held to where it is sound: one precision, and nobody
// switching representation across the merge. Both conditions are needed, since
// either a fold to a coarser p or a promotion to dense replaces an exact count
// with an estimate. 0 violations in the 6,291 pairs of the sweep that qualify.
test("a union counts at least its larger input, representation held", () => {
  fc.assert(
    fc.property(keySet, keySet, precision, (ka, kb, p) => {
      const a = sketchOf(ka, p);
      const b = sketchOf(kb, p);
      const merged = sketchOf(ka, p).union(sketchOf(kb, p));
      // fc.pre rather than an early return: a skipped run is counted, so if
      // this ever swallowed most of the inputs the run would fail instead of
      // passing on nothing.
      fc.pre(encoding(a) === encoding(merged));
      fc.pre(encoding(b) === encoding(merged));

      expect(merged.count()).toBeGreaterThanOrEqual(
        Math.max(a.count(), b.count()),
      );
    }),
  );
});
