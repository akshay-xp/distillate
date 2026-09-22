import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import type { CardinalityRow } from "../src/cardinality.js";
import type { ComparisonRow } from "../src/compare.js";
import type { CuckooRow } from "../src/cuckoo.js";
import type { ScalableRow } from "../src/scalable.js";
import {
  cardinalityTable,
  cuckooTable,
  renderResults,
  scalableTable,
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

const cardinalityRow: CardinalityRow = {
  name: "distillate/hll",
  p: 14,
  registers: 16384,
  n: 100000,
  estimate: 100080,
  relativeError: 0.0008,
  bytes: 12314,
  format: "binary",
  buildMs: 580,
  addOpsPerSec: 17_241_379,
};

test("cardinalityTable leads with accuracy and space, size carrying its format", () => {
  const table = cardinalityTable([cardinalityRow]);
  const columns = [
    "Sketch",
    "n",
    "registers",
    "estimate",
    "rel. error",
    "size",
  ];
  let cursor = -1;
  for (const column of columns) {
    const at = table.indexOf(column);
    expect(at).toBeGreaterThan(cursor);
    cursor = at;
  }
  expect(table).toContain("distillate/hll");
  expect(table).toContain("0.08%");
  expect(table).toContain("12314");
  expect(table).toContain("binary");
  expect(table).toContain("580 ms");
  expect(table).toContain("17.24 M ops/s");
});

test("cardinalityTable switches build time from ms to s past a second", () => {
  expect(cardinalityTable([{ ...cardinalityRow, buildMs: 42.5 }])).toContain(
    "43 ms",
  );
  // The incumbent's 1M row, measured.
  expect(cardinalityTable([{ ...cardinalityRow, buildMs: 104_900 }])).toContain(
    "104.90 s",
  );
});

test("renderResults places cardinality before throughput and states the basis", () => {
  const md = renderResults({
    banner: "distillate-bench | node v24 | arm64 | Apple M1 | 8 cores",
    version: "0.1.1",
    date: "2026-07-31",
    targetFpr: 0.01,
    throughputCapacity: 100000,
    spaceTable: "SPACE_TBL",
    throughputTable: "TPUT_TBL",
    cardinalityTable: "CARD_TBL",
  });
  expect(md).toContain("## Cardinality");
  expect(md).toContain("matched register count");
  expect(md).toContain("CARD_TBL");
  expect(md.indexOf("## Cardinality")).toBeLessThan(
    md.indexOf("## Throughput"),
  );
});

test("METHODOLOGY states the cardinality matching basis and why", () => {
  const md = readFileSync(
    fileURLToPath(new URL("../METHODOLOGY.md", import.meta.url)),
    "utf8",
  );
  expect(md).toContain("HyperLogLog");
  expect(md).toContain("matched register count");
  expect(md).toContain("m = 2 ** p");
  // The reason equal memory was rejected as the basis.
  expect(md).toContain("representation");
});

const scalableRowsFixture: ScalableRow[] = [
  {
    name: "distillate/scalable",
    keys: 100_000,
    stages: 7,
    bitsPerKey: 11.234,
    measuredFpr: 0.00631,
    addOpsPerSec: 4_200_000,
    hasOpsPerSec: 6_100_000,
  },
  {
    name: "bloom-filters",
    keys: 1_000,
    stages: 1,
    bitsPerKey: 14.5,
    measuredFpr: 0.0182,
    addOpsPerSec: 310_000,
    hasOpsPerSec: 420_000,
  },
];

test("scalableTable renders stages, space, FPR and both throughputs", () => {
  const table = scalableTable(scalableRowsFixture);
  expect(table).toContain(
    "| Filter | keys | stages | bits/key | measured FPR | add | has |",
  );
  expect(table).toContain(
    "| distillate/scalable | 100k | 7 | 11.23 | 0.63% | 4.20 M ops/s | 6.10 M ops/s |",
  );
  expect(table).toContain(
    "| bloom-filters | 1k | 1 | 14.50 | 1.82% | 310 k ops/s | 420 k ops/s |",
  );
});

test("renderResults places the scalable section after cardinality and states its basis", () => {
  const md = renderResults({
    banner: "distillate-bench | node v24 | arm64 | Apple M1 | 8 cores",
    version: "0.1.1",
    date: "2026-07-31",
    targetFpr: 0.01,
    throughputCapacity: 100000,
    spaceTable: "SPACE_TBL",
    throughputTable: "TPUT_TBL",
    cardinalityTable: "CARD_TBL",
    scalableTable: "SCALABLE_TBL",
  });
  expect(md).toContain("SCALABLE_TBL");
  const at = md.indexOf("## Scalable Bloom");
  expect(at).toBeGreaterThan(md.indexOf("## Cardinality"));
  expect(at).toBeLessThan(md.indexOf("## Throughput"));
  const section = md.slice(at, md.indexOf("## Throughput"));
  for (const phrase of [
    "ratio",
    "load factor",
    "growth 2",
    "errorRate / (1 - ratio)",
  ]) {
    expect(section, phrase).toContain(phrase);
  }
});

test("METHODOLOGY states the scalable matching basis and the load-factor quirk", () => {
  const md = readFileSync(
    fileURLToPath(new URL("../METHODOLOGY.md", import.meta.url)),
    "utf8",
  );
  expect(md).toContain("Scalable Bloom");
  expect(md).toContain("initial size");
  expect(md).toContain("ratio");
  expect(md).toContain("load factor");
});

/** `## heading` up to the next `## `, so one section never reads another's rows. */
function resultsSection(md: string, heading: string): string {
  const at = md.indexOf(`## ${heading}`);
  const end = md.indexOf("\n## ", at + 1);
  return end === -1 ? md.slice(at) : md.slice(at, end);
}

test("RESULTS carries the measured scalable section for both filters", () => {
  const md = readFileSync(
    fileURLToPath(new URL("../RESULTS.md", import.meta.url)),
    "utf8",
  );
  expect(md).toContain("## Scalable Bloom");
  const section = resultsSection(md, "Scalable Bloom");
  const rows = section
    .split("\n")
    .filter((l) => /^\| (distillate\/scalable|bloom-filters) /.test(l));
  expect(rows).toHaveLength(10);
  const cells = (r: string): string[] => r.split("|").map((c) => c.trim());
  const row = (name: string, keys: string): string | undefined =>
    rows.find((r) => cells(r)[1] === name && cells(r)[2] === keys);
  for (const keys of ["1k", "10k", "100k", "1M", "10M"]) {
    expect(row("distillate/scalable", keys), keys).toBeDefined();
    expect(row("distillate/scalable", keys), keys).not.toContain("not run");
  }
  for (const keys of ["1k", "10k", "100k"]) {
    expect(row("bloom-filters", keys), keys).not.toContain("not run");
  }
  for (const keys of ["1M", "10M"]) {
    expect(row("bloom-filters", keys), keys).toContain("not run");
  }
  // The header note says which build the section was measured on.
  expect(md.slice(0, md.indexOf("## Space"))).toContain("Scalable Bloom");
});

const cuckooRowsFixture: CuckooRow[] = [
  {
    name: "distillate/cuckoo",
    keys: 100_000,
    bitsPerKey: 10.6532,
    measuredFpr: 0.0074,
    addOpsPerSec: 4_800_000,
    hasOpsPerSec: 9_100_000,
    deleteOpsPerSec: 8_300_000,
    lostAfterBuild: 0,
    lostAfterDelete: 0,
    refused: 0,
  },
  {
    name: "bloom-filters",
    keys: 1_000,
    bitsPerKey: 8.384,
    measuredFpr: 0.0291,
    addOpsPerSec: 230_000,
    hasOpsPerSec: 300_000,
    deleteOpsPerSec: 280_000,
    lostAfterBuild: 274,
    lostAfterDelete: 131,
    refused: 0,
  },
];

test("cuckooTable renders space, FPR, lost keys and three throughputs", () => {
  const table = cuckooTable(cuckooRowsFixture);
  expect(table).toContain(
    "| Filter | keys | bits/key | measured FPR | lost after build | lost after delete | refused | add | has | delete |",
  );
  expect(table).toContain(
    "| distillate/cuckoo | 100k | 10.65 | 0.74% | 0 (0.00%) | 0 (0.00%) | 0 | 4.80 M ops/s | 9.10 M ops/s | 8.30 M ops/s |",
  );
  // Lost after delete is a share of the kept half, 500 keys at 1k.
  expect(table).toContain(
    "| bloom-filters | 1k | 8.38 | 2.91% | 274 (27.40%) | 131 (26.20%) | 0 | 230 k ops/s | 300 k ops/s | 280 k ops/s |",
  );
});

test("renderResults places the cuckoo section after scalable and states its basis", () => {
  const md = renderResults({
    banner: "distillate-bench | node v24 | arm64 | Apple M1 | 8 cores",
    version: "0.1.1",
    date: "2026-07-31",
    targetFpr: 0.01,
    throughputCapacity: 100000,
    spaceTable: "SPACE_TBL",
    throughputTable: "TPUT_TBL",
    cardinalityTable: "CARD_TBL",
    scalableTable: "SCALABLE_TBL",
    cuckooTable: "CUCKOO_TBL",
  });
  expect(md).toContain("CUCKOO_TBL");
  const at = md.indexOf("## Cuckoo");
  expect(at).toBeGreaterThan(md.indexOf("## Scalable Bloom"));
  expect(at).toBeLessThan(md.indexOf("## Throughput"));
  const section = md.slice(at, md.indexOf("## Throughput"));
  for (const phrase of [
    "hex characters",
    "nominal",
    "false negative",
    "delete-half",
  ]) {
    expect(section, phrase).toContain(phrase);
  }
});

test("METHODOLOGY states the cuckoo configuration and the delete-half workload", () => {
  const md = readFileSync(
    fileURLToPath(new URL("../METHODOLOGY.md", import.meta.url)),
    "utf8",
  );
  const at = md.indexOf("## Configuration for Cuckoo");
  expect(at).toBeGreaterThan(-1);
  const section = md.slice(at, md.indexOf("\n## ", at + 1));
  for (const phrase of ["bucket", "500", "hex characters", "delete-half"]) {
    expect(section, phrase).toContain(phrase);
  }
});

test("scalableTable marks a row that was not run with its projected build", () => {
  const table = scalableTable([
    {
      name: "bloom-filters",
      keys: 10_000_000,
      notRun: true,
      projectedBuildMs: 2.736e8,
    },
  ]);
  expect(table).toContain("| bloom-filters | 10M | not run |");
  expect(table).toContain("~76.0 h projected build");
});

test("RESULTS carries the measured cuckoo section for both filters", () => {
  const md = readFileSync(
    fileURLToPath(new URL("../RESULTS.md", import.meta.url)),
    "utf8",
  );
  expect(md).toContain("## Cuckoo");
  const rows = resultsSection(md, "Cuckoo")
    .split("\n")
    .filter((l) => /^\| (distillate\/cuckoo|bloom-filters) /.test(l));
  expect(rows).toHaveLength(10);
  const cells = (r: string): string[] => r.split("|").map((c) => c.trim());
  for (const keys of ["1k", "10k", "100k", "1M", "10M"]) {
    for (const name of ["distillate/cuckoo", "bloom-filters"]) {
      const row = rows.find(
        (r) => cells(r)[1] === name && cells(r)[2] === keys,
      );
      expect(row, `${name} ${keys}`).toBeDefined();
    }
  }
  // Lost after build, lost after delete and refused are columns 5 to 7.
  for (const r of rows.filter((r) => cells(r)[1] === "distillate/cuckoo")) {
    expect(cells(r).slice(5, 8)).toEqual(["0 (0.00%)", "0 (0.00%)", "0"]);
  }
  // The header note says which build the section was measured on.
  expect(md.slice(0, md.indexOf("## Space"))).toContain("Cuckoo");
});
