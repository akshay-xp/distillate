import { describe, expect, test } from "vitest";

import { DDSketch } from "../../src/ddsketch/ddsketch.js";
import { denseStore, type Store } from "../../src/ddsketch/store.js";
import { lognormalValues } from "../helpers/quantile.js";

function binsOf(store: Store): [number, number][] {
  const out: [number, number][] = [];
  store.forEach((index, count) => out.push([index, count]));
  return out;
}

describe.each([denseStore()])("$kind store", (factory) => {
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
