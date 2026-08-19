import { expect, test } from "vitest";

import type { ComparisonRow } from "../src/compare.js";
import {
  renderResults,
  spaceAccuracyTable,
  throughputTable,
} from "../src/report.js";

const classic: ComparisonRow = {
  name: "distillate/bloom",
  n: 100000,
  targetFpr: 0.01,
  measuredFpr: 0.0098,
  bitsPerKey: 9.59,
  standalone: false,
};

const standalone: ComparisonRow = {
  name: "fuse8",
  n: 100000,
  targetFpr: 2 ** -8,
  measuredFpr: 0.0039,
  bitsPerKey: 9.1,
  standalone: true,
};

test("spaceAccuracyTable renders headers, formatted cells, and standalone label", () => {
  const table = spaceAccuracyTable([classic, standalone]);
  expect(table).toContain("Structure");
  expect(table).toContain("bits/key");
  expect(table).toContain("measured FPR");
  expect(table).toContain("100k");
  expect(table).toContain("9.59");
  expect(table).toContain("0.98%");
  expect(table).toContain("no incumbent equivalent");
});

test("throughputTable renders labels and formatted ops in insertion order", () => {
  const table = throughputTable(
    new Map([
      ["distillate/bloom has (hit)", 6_800_000],
      ["bloom-filters has (hit)", 285_000],
    ]),
  );
  expect(table).toContain("distillate/bloom has (hit)");
  expect(table).toContain("bloom-filters has (hit)");
  expect(table).toContain("6.80 M ops/s");
  expect(table).toContain("285 k ops/s");
  expect(table.indexOf("distillate/bloom")).toBeLessThan(
    table.indexOf("bloom-filters"),
  );
});

test("renderResults includes metadata, tables, and the fairness statement", () => {
  const md = renderResults({
    banner: "distillate-bench | node v24 | arm64 | Apple M1 | 8 cores",
    version: "0.1.1",
    date: "2026-07-31",
    targetFpr: 0.01,
    throughputCapacity: 100000,
    spaceTable: "SPACE_TBL",
    throughputTable: "TPUT_TBL",
  });
  expect(md).toContain("0.1.1");
  expect(md).toContain("2026-07-31");
  expect(md).toContain(
    "distillate-bench | node v24 | arm64 | Apple M1 | 8 cores",
  );
  expect(md).toContain("SPACE_TBL");
  expect(md).toContain("TPUT_TBL");
  expect(md).toContain("same target FPR");
  expect(md).toContain("identical code");
  expect(md).toContain("[METHODOLOGY.md](./METHODOLOGY.md)");
});

test("renderResults calls throughput machine-relative between the two tables", () => {
  const md = renderResults({
    banner: "distillate-bench | node v24 | arm64 | Apple M1 | 8 cores",
    version: "0.1.1",
    date: "2026-07-31",
    targetFpr: 0.01,
    throughputCapacity: 100000,
    spaceTable: "SPACE_TBL",
    throughputTable: "TPUT_TBL",
  });
  const caveat = md.indexOf("machine-relative");
  expect(caveat).toBeGreaterThan(-1);
  expect(caveat).toBeGreaterThan(md.indexOf("SPACE_TBL"));
  expect(caveat).toBeLessThan(md.indexOf("TPUT_TBL"));
});
