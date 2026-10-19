import { expect, test } from "vitest";

import type { CuckooRow } from "../src/cuckoo.js";
import {
  interleave,
  isolatedRows,
  isolatedThroughput,
  runIsolated,
} from "../src/isolate.js";
import { throughputNames } from "../src/throughput.js";

test("interleave merges per-adapter rows by key count, then adapter order", () => {
  expect(
    interleave([
      ["a1", "a2"],
      ["b1", "b2"],
    ]),
  ).toEqual(["a1", "b1", "a2", "b2"]);
  expect(interleave([["a1", "a2"]])).toEqual(["a1", "a2"]);
});

test("runIsolated measures one adapter's section in a separate process", () => {
  const { pid, rows } = runIsolated<CuckooRow>("cuckoo", "distillate/cuckoo", [
    [1000],
  ]);
  expect(pid).not.toBe(process.pid);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: "distillate/cuckoo", keys: 1000 });
});

test("runIsolated names an adapter the section does not have", () => {
  expect(() => runIsolated("cuckoo", "no-such-filter", [[1000]])).toThrow(
    /no-such-filter/,
  );
});

test("the minhash jobs resolve each library by name", () => {
  const sketches = runIsolated<{ name: string }>("minhash", "minhash", [
    [1000],
  ]);
  expect(sketches.rows.map((r) => r.name)).toEqual(["minhash"]);
  const index = runIsolated<{ name: string }>(
    "minhash-lsh",
    "distillate/minhash",
    [1000],
  );
  expect(index.rows.map((r) => r.name)).toEqual(["distillate/minhash"]);
  expect(() => runIsolated("minhash-lsh", "bloom-filters", [1000])).toThrow(
    /bloom-filters/,
  );
});

test("isolatedRows runs each adapter in turn and keeps the sweep order", () => {
  const rows = isolatedRows<CuckooRow>(
    "cuckoo",
    ["distillate/cuckoo", "bloom-filters"],
    [[1000, 2000]],
  );
  expect(rows.map((r) => [r.name, r.keys])).toEqual([
    ["distillate/cuckoo", 1000],
    ["bloom-filters", 1000],
    ["distillate/cuckoo", 2000],
    ["bloom-filters", 2000],
  ]);
});

test("the throughput job runs only the named library's benches", () => {
  const { rows } = runIsolated<[string, number]>(
    "throughput",
    "bloomfilter",
    [1000],
  );
  expect(rows.map(([label]) => label)).toEqual([
    "bloomfilter add",
    "bloomfilter has (hit)",
    "bloomfilter has (miss)",
  ]);
  for (const [, ops] of rows) {
    expect(Number.isFinite(ops) && ops > 0).toBe(true);
  }
});

test("throughputNames lists every library in the table's order", () => {
  expect(throughputNames()).toEqual([
    "distillate/bloom",
    "bloom-filters",
    "bloomfilter",
    "blocked",
    "fuse8",
    "fuse16",
    "distillate/hll",
    "bloom-filters hll",
  ]);
});

test("isolatedThroughput lists each library's labels in turn, whatever their count", () => {
  const labels = isolatedThroughput(1000, ["bloomfilter", "blocked"]).map(
    ([label]) => label,
  );
  expect(labels).toEqual([
    "bloomfilter add",
    "bloomfilter has (hit)",
    "bloomfilter has (miss)",
    "blocked has (hit)",
    "blocked has (miss)",
  ]);
});

test("the ddsketch job measures only the named library", () => {
  const { rows } = runIsolated<{ name: string; events: number }>(
    "ddsketch",
    "@datadog/sketches-js",
    [[1000]],
  );
  expect(rows.map((r) => [r.name, r.events])).toEqual([
    ["@datadog/sketches-js", 1000],
  ]);
});

test("the riblt job resolves each reconciler by name", () => {
  const rows = runIsolated<{ name: string }>("riblt", "distillate/riblt", [
    [[1000, 10]],
  ]);
  expect(rows.rows.map((r) => r.name)).toEqual(["distillate/riblt"]);
  expect(() =>
    runIsolated("riblt", "no-such-reconciler", [[[1000, 10]]]),
  ).toThrow(/no-such-reconciler/);
});

test("the theta job resolves each library by name", () => {
  const rows = runIsolated<{ name: string }>("theta", "distillate/hll", [
    2000,
    [0.1],
    1,
  ]);
  expect(rows.rows.map((r) => r.name)).toEqual(["distillate/hll"]);
  expect(() =>
    runIsolated("theta", "no-such-library", [2000, [0.1], 1]),
  ).toThrow(/no-such-library/);
});
