import { expect, test } from "vitest";
import { KllSketch } from "distillate/kll";

import {
  KLL_DISTRIBUTIONS,
  KLL_N,
  KLL_SEEDS,
  kllRows,
  rankAdapters,
} from "../src/kll.js";

test("the bench compares KLL with DDSketch, tdigest and an exact array", () => {
  expect(rankAdapters.map((a) => a.name)).toEqual([
    "distillate/kll",
    "distillate/ddsketch",
    "tdigest",
    "tdigest (delta = 0.1)",
    "Array",
  ]);
  expect(KLL_DISTRIBUTIONS).toEqual(["uniform", "lognormal", "ascending"]);
  expect(KLL_N).toBe(1_000_000);
  expect(KLL_SEEDS).toBe(10);
});

test("kll rows time each library and score its quantiles in rank", () => {
  const n = 20_000;
  const rows = kllRows(n, ["uniform", "ascending"], 2);

  expect(rows.map((r) => [r.distribution, r.name])).toEqual(
    ["uniform", "ascending"].flatMap((d) =>
      rankAdapters.map((a) => [d, a.name]),
    ),
  );
  for (const r of rows) {
    expect(r.addOpsPerSec, r.name).toBeGreaterThan(0);
    expect(r.mergeMs, r.name).toBeGreaterThan(0);
    expect(r.bytes, r.name).toBeGreaterThan(0);
    for (const e of r.rankErrors) expect(Number.isFinite(e), r.name).toBe(true);
    if (r.name === "Array") {
      expect(r.bytes).toBe(8 * n);
      expect(r.rankErrors).toEqual([0, 0, 0]);
    }
    if (r.name === "distillate/kll") {
      for (const e of r.rankErrors) {
        expect(e).toBeLessThanOrEqual(new KllSketch().normalizedRankError());
      }
    }
  }
});

test("kll is exact below k", () => {
  const kll = kllRows(150, ["uniform"], 1).find(
    (r) => r.name === "distillate/kll",
  );
  expect(kll?.rankErrors).toEqual([0, 0, 0]);
});
