import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import {
  collapsingHighestStore,
  collapsingLowestStore,
  denseStore,
  sparseStore,
  type Store,
} from "../../src/ddsketch/store.js";
import { lognormalValues } from "../helpers/quantile.js";
import { allocatedBy } from "../helpers/topk.js";

function binsOf(store: Store): [number, number][] {
  const out: [number, number][] = [];
  store.forEach((index, count) => out.push([index, count]));
  return out;
}

describe.each([denseStore(), sparseStore()])("$kind store", (factory) => {
  test("is unbounded", () => {
    expect(factory.maxBins).toBe(0);
  });

  test("yields its non-empty bins in ascending index order", () => {
    const store = factory.create();
    for (const [index, count] of [
      [5, 1],
      [-3, 1],
      [5, 1],
      [100, 2],
    ] as const) {
      store.add(index, count);
    }
    expect(binsOf(store)).toEqual([
      [-3, 1],
      [5, 2],
      [100, 2],
    ]);
    expect(store.total).toBe(5);
  });

  test("a sketch built on it answers as the default", () => {
    const values = lognormalValues(21, 1000);
    const qs = [0, 0.1, 0.5, 0.9, 0.99, 1];
    expect(
      DDSketch.from(values, 0.01, { store: factory }).quantiles(qs),
    ).toEqual(DDSketch.from(values, 0.01).quantiles(qs));
  });
});

describe("sparse store", () => {
  test("holds only the bins it was given, however far apart", () => {
    const store = sparseStore().create();
    store.add(1e6, 1);
    store.add(-1e6, 2);
    expect(binsOf(store)).toEqual([
      [-1e6, 2],
      [1e6, 1],
    ]);
  });

  test("ranks like the dense store", () => {
    const dense = denseStore().create();
    const sparse = sparseStore().create();
    for (const [index, count] of [
      [7, 2],
      [-4, 1],
      [30, 3],
      [7, 1],
      [0, 2],
    ] as const) {
      dense.add(index, count);
      sparse.add(index, count);
    }
    for (let rank = 0; rank < dense.total; rank++) {
      expect(sparse.keyAtRank(rank)).toBe(dense.keyAtRank(rank));
    }
  });
});

describe("collapsing-lowest store", () => {
  test("reports its kind and bound", () => {
    const factory = collapsingLowestStore(64);
    expect([factory.kind, factory.maxBins]).toEqual(["collapsingLowest", 64]);
  });

  test("never spans more than maxBins, folding the lowest into the floor", () => {
    const store = collapsingLowestStore(64).create();
    for (let i = 0; i < 1000; i++) store.add(i, 1);
    const bins = binsOf(store);
    expect(bins[0]).toEqual([936, 937]);
    expect(bins.at(-1)).toEqual([999, 1]);
    expect(bins).toHaveLength(64);
    expect(store.total).toBe(1000);
  });

  test("holds the same bins as a dense store until it collapses", () => {
    const collapsing = collapsingLowestStore(64).create();
    const dense = denseStore().create();
    for (const i of [3, 40, -7, 12, 40, 55, 0, -2, 9, 33]) {
      collapsing.add(i, 1);
      dense.add(i, 1);
    }
    expect(binsOf(collapsing)).toEqual(binsOf(dense));
  });

  test("rejects a maxBins that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => collapsingLowestStore(bad)).toThrow(ParamError);
    }
  });
});

describe("collapsing-highest store", () => {
  test("reports its kind and bound", () => {
    const factory = collapsingHighestStore(64);
    expect([factory.kind, factory.maxBins]).toEqual(["collapsingHighest", 64]);
  });

  test("never spans more than maxBins, folding the highest into the ceiling", () => {
    const store = collapsingHighestStore(64).create();
    for (let i = 0; i < 1000; i++) store.add(i, 1);
    const bins = binsOf(store);
    expect(bins[0]).toEqual([0, 1]);
    expect(bins.at(-1)).toEqual([63, 937]);
    expect(bins).toHaveLength(64);
    expect(store.total).toBe(1000);
  });

  test("rejects a maxBins that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => collapsingHighestStore(bad)).toThrow(ParamError);
    }
  });
});

// sketches-go never lets a collapsing store's array outgrow maxBins: two
// values 600 orders of magnitude apart at 1e-4 are 14 million indices apart,
// and holding every slot between them would retain over 100 MB.
describe.each([
  {
    factory: collapsingLowestStore(2048),
    adds: [-7_000_000, 7_000_000],
    expected: [
      [7_000_000 - 2047, 1],
      [7_000_000, 1],
    ],
  },
  {
    factory: collapsingHighestStore(2048),
    adds: [7_000_000, -7_000_000],
    expected: [
      [-7_000_000, 1],
      [-7_000_000 + 2047, 1],
    ],
  },
])("$factory.kind store", ({ factory, adds, expected }) => {
  test("keeps memory within maxBins however far apart the indices", () => {
    const { value: store, bytes } = allocatedBy(() => {
      const s = factory.create();
      // The kept end second, so the first add is what gets folded.
      for (const index of adds) s.add(index, 1);
      return s;
    });
    expect(bytes).toBeLessThan(64 * 1024);
    expect(binsOf(store)).toEqual(expected);
  });
});

test("every store answers alike until one collapses", () => {
  const values = lognormalValues(22, 10_000);
  const qs = [0, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999, 1];
  const answers = [
    denseStore(),
    sparseStore(),
    collapsingLowestStore(4096),
    collapsingHighestStore(4096),
  ].map((store) => DDSketch.from(values, 0.01, { store }).quantiles(qs));
  for (const answer of answers) expect(answer).toEqual(answers[0]);
});
