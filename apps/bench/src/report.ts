import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { run } from "mitata";

import {
  cardinalityRows,
  HLL_CARDINALITIES,
  HLL_PRECISION,
} from "./cardinality.js";
import type { CardinalityRow } from "./cardinality.js";
import { comparisonRows } from "./compare.js";
import {
  SCALABLE_INITIAL,
  SCALABLE_KEY_COUNTS,
  scalableRows,
} from "./scalable.js";
import type { ScalableRow } from "./scalable.js";
import { CUCKOO_KEY_COUNTS, cuckooRows } from "./cuckoo.js";
import type { CuckooRow } from "./cuckoo.js";
import { COUNTMIN_KEY_COUNTS, countMinRows } from "./countmin.js";
import type { CountMinRow } from "./countmin.js";
import type { ComparisonRow } from "./compare.js";
import { TARGET_FPR } from "./adapters.js";
import { envBanner } from "./harness.js";
import { registerThroughputBenches } from "./throughput.js";

function capacityLabel(n: number): string {
  if (n >= 1_000_000) return `${String(n / 1_000_000)}M`;
  if (n >= 1_000) return `${String(n / 1_000)}k`;
  return String(n);
}

export function spaceAccuracyTable(rows: ComparisonRow[]): string {
  const header =
    "| Structure | Capacity | bits/key | measured FPR | Notes |\n" +
    "| --- | --- | --- | --- | --- |";
  const body = rows.map((r) => {
    const notes = r.standalone ? "no incumbent equivalent" : "";
    return `| ${r.name} | ${capacityLabel(r.n)} | ${r.bitsPerKey.toFixed(2)} | ${(r.measuredFpr * 100).toFixed(2)}% | ${notes} |`;
  });
  return [header, ...body].join("\n");
}

function ops(v: number): string {
  return v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(2)} M ops/s`
    : `${(v / 1_000).toFixed(0)} k ops/s`;
}

function duration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(0)} ms`;
}

export function cardinalityTable(rows: CardinalityRow[]): string {
  const header =
    "| Sketch | n | registers | estimate | rel. error | size | build |\n" +
    "| --- | --- | --- | --- | --- | --- | --- |";
  const body = rows.map(
    (r) =>
      `| ${r.name} | ${capacityLabel(r.n)} | ${String(r.registers)} | ${String(Math.round(r.estimate))} | ${(r.relativeError * 100).toFixed(2)}% | ${String(r.bytes)} B ${r.format} | ${duration(r.buildMs)} (${ops(r.addOpsPerSec)}) |`,
  );
  return [header, ...body].join("\n");
}

function projected(ms: number): string {
  if (ms >= 3_600_000) return `~${(ms / 3_600_000).toFixed(1)} h`;
  if (ms >= 60_000) return `~${(ms / 60_000).toFixed(0)} min`;
  return `~${(ms / 1000).toFixed(0)} s`;
}

export function scalableTable(rows: ScalableRow[]): string {
  const header =
    "| Filter | keys | stages | bits/key | measured FPR | add | has |\n" +
    "| --- | --- | --- | --- | --- | --- | --- |";
  const body = rows.map((r) =>
    "notRun" in r
      ? `| ${r.name} | ${capacityLabel(r.keys)} | not run | - | - | ${projected(r.projectedBuildMs)} projected build | - |`
      : `| ${r.name} | ${capacityLabel(r.keys)} | ${String(r.stages)} | ${r.bitsPerKey.toFixed(2)} | ${(r.measuredFpr * 100).toFixed(2)}% | ${ops(r.addOpsPerSec)} | ${ops(r.hasOpsPerSec)} |`,
  );
  return [header, ...body].join("\n");
}

function lost(count: number, of: number): string {
  return `${String(count)} (${((count / of) * 100).toFixed(2)}%)`;
}

export function cuckooTable(rows: CuckooRow[]): string {
  const header =
    "| Filter | keys | bits/key | measured FPR | lost after build | lost after delete | refused | add | has | delete |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = rows.map((r) => {
    const kept = r.keys - Math.floor(r.keys / 2);
    return `| ${r.name} | ${capacityLabel(r.keys)} | ${r.bitsPerKey.toFixed(2)} | ${(r.measuredFpr * 100).toFixed(2)}% | ${lost(r.lostAfterBuild, r.keys)} | ${lost(r.lostAfterDelete, kept)} | ${String(r.refused)} | ${ops(r.addOpsPerSec)} | ${ops(r.hasOpsPerSec)} | ${ops(r.deleteOpsPerSec)} |`;
  });
  return [header, ...body].join("\n");
}

export function countMinTable(rows: CountMinRow[]): string {
  const header =
    "| Sketch | events | grid | size | mean over | max over | over bound | under | add | count |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = rows.map(
    (r) =>
      `| ${r.name} | ${capacityLabel(r.events)} | ${String(r.width)} x ${String(r.depth)} | ${String(r.bytes)} B | ${r.meanOverestimate.toFixed(1)} | ${String(r.maxOverestimate)} | ${(r.overBoundShare * 100).toFixed(2)}% | ${String(r.underestimates)} | ${ops(r.addOpsPerSec)} | ${ops(r.countOpsPerSec)} |`,
  );
  return [header, ...body].join("\n");
}

export interface ResultsOptions {
  banner: string;
  version: string;
  date: string;
  targetFpr: number;
  throughputCapacity: number;
  spaceTable: string;
  throughputTable: string;
  cardinalityTable?: string;
  scalableTable?: string;
  cuckooTable?: string;
  countMinTable?: string;
}

function cardinalitySection(table: string): string[] {
  return [
    "## Cardinality",
    "",
    "Both sketches are built at a matched register count (`m = 2 ** p`), so they carry the same theoretical error of `1.04 / sqrt(m)`.",
    "Equal memory was rejected as the basis: it would hand the incumbent roughly a eleventh of the registers, making its accuracy look bad for a reason that is really about representation rather than estimation.",
    "",
    "The two sizes are not the same encoding. distillate writes a binary payload and `bloom-filters` writes JSON, so each row names its format.",
    "",
    "distillate is exact at small cardinalities because it is still holding sparse entries there, not because its estimator is better.",
    "Once it promotes to dense registers it carries the same theoretical error as any HyperLogLog at that precision.",
    "",
    table,
    "",
  ];
}

export function scalableSection(table: string): string[] {
  return [
    "## Scalable Bloom",
    "",
    "Both filters are built from the same arguments: an initial size of 1,000 keys, a 1% target, growth 2, and `ratio` 0.5.",
    "That is the incumbent's own default configuration, since `bloom-filters` fixes growth at 2 and defaults `ratio` to 0.5, so distillate is set to match it (`growth: 2, tightening: 0.5`).",
    "",
    "The two do not grow on the same trigger. `bloom-filters` passes `ratio` to each stage twice: as the tightening factor and as the stage's load factor, and it opens a new stage when a stage's fill passes that load factor rather than after a count of keys.",
    "So an equal initial size is the same argument, not identical stage capacities, and the stage counts can differ.",
    "",
    "Its first stage targets the full rate and later ones `errorRate * ratio ** i`, so its targets sum to `errorRate / (1 - ratio)`, twice the requested rate at `ratio` 0.5.",
    "distillate starts at `epsilon * (1 - tightening)`, so its whole chain targets `epsilon`.",
    "Bits per key is allocated bits over keys added; FPR is measured over 100,000 keys neither filter saw.",
    "",
    "distillate is measured from 1k to 10M keys, the same reach as every other structure. The incumbent stops at 100k: every `add` recounts the newest stage's set bits (`_currentload`), so its build time grows with the square of the key count.",
    "Past 100k its rows project the build time from its own 100k run rather than running for hours at 1M and days at 10M.",
    "",
    table,
    "",
  ];
}

export function cuckooSection(table: string): string[] {
  return [
    "## Cuckoo",
    "",
    "Both filters are built by `create(n, 0.01)`, which gives both buckets of 4 and a limit of 500 kicks per add.",
    "The fingerprint does not match: `bloom-filters` stores `ceil(f / 8)` hex characters of a 32-bit hash, 2 characters and so 8 bits at 1%, where distillate stores the 10 bits the target calls for.",
    "Bits per key is nominal slot bits over keys; the incumbent keeps each fingerprint as a JS string, so its heap is far larger than its row shows.",
    "",
    "Each row runs a delete-half workload: add `n` keys, count the ones `has` then denies, measure FPR over 100,000 keys neither filter saw, delete the first half, and count kept keys that `has` denies.",
    "A key that was added and not deleted but reads absent is a false negative, the one answer a filter must never give. Refused counts adds that reported the filter full.",
    "",
    table,
    "",
  ];
}

export function countMinSection(table: string): string[] {
  return [
    "## Count-Min",
    "",
    "Both sketches are built at the same geometry, 2,719 columns by 7 rows, which is what `epsilon` 0.001 and `delta` 0.001 call for.",
    "",
    'Reaching that geometry in `bloom-filters` means passing `0.001` to an argument its documentation calls "the probability of accuracy".',
    "Its `create(errorRate, accuracy = 0.999)` sizes rows as `Math.ceil(Math.log(1 / accuracy))`, a formula that wants `delta`, the failure probability; the comment directly above that line in its source even reads `rows = Math.ceil(Math.log(1 / delta))`.",
    "Measured: `create(0.001)` and `create(0.001, 0.999)` both give 2,719 columns by **one** row, where taking the minimum across rows buys nothing at all.",
    "A reader following its documentation gets that single-row sketch. The rows below give it the seven the target calls for, so the comparison is at equal size rather than against a sketch a seventh the height.",
    "",
    "Accuracy is measured on a Zipf-skewed stream over 10,000 distinct keys, the shape a frequency sketch exists for: a uniform stream spreads counts evenly and hides the collisions between one heavy key and the light tail sharing its column.",
    "`mean over` and `max over` are how far above the true count an estimate sits, and `over bound` is the share of keys past `epsilon * events`, which the geometry allows at up to `delta`.",
    "`under` counts answers below the true count, which neither sketch may ever give; it is measured rather than assumed.",
    "",
    "The two sizes are not the same encoding: distillate writes a binary frame and `bloom-filters` writes JSON.",
    "",
    table,
    "",
  ];
}

export function renderResults(opts: ResultsOptions): string {
  return [
    "# distillate-bench results",
    "",
    `- Machine: ${opts.banner}`,
    `- Package: distillate@${opts.version}`,
    `- Date: ${opts.date}`,
    "",
    `All filters are configured at the same target FPR (${String(opts.targetFpr * 100)}%) and measured by identical code.`,
    "See [METHODOLOGY.md](./METHODOLOGY.md) for how these benches are run.",
    "",
    "## Space and accuracy",
    "",
    opts.spaceTable,
    "",
    ...(opts.cardinalityTable ? cardinalitySection(opts.cardinalityTable) : []),
    ...(opts.scalableTable ? scalableSection(opts.scalableTable) : []),
    ...(opts.cuckooTable ? cuckooSection(opts.cuckooTable) : []),
    ...(opts.countMinTable ? countMinSection(opts.countMinTable) : []),
    `## Throughput (n = ${capacityLabel(opts.throughputCapacity)})`,
    "",
    "Absolute throughput is machine-relative: it depends on the CPU, the runtime, and the load on the box at measurement time.",
    "Compare the ratios between rows, not these figures against a run on another machine.",
    "",
    opts.throughputTable,
    "",
  ].join("\n");
}

export function throughputTable(opsByLabel: Map<string, number>): string {
  const header = "| Operation | Throughput |\n| --- | --- |";
  const body = [...opsByLabel].map(([label, v]) => `| ${label} | ${ops(v)} |`);
  return [header, ...body].join("\n");
}

const CAPACITIES = [100_000, 1_000_000];
const THROUGHPUT_CAPACITY = 100_000;

interface MitataResult {
  benchmarks: { alias: string; runs: { stats: { avg: number } }[] }[];
}

async function collectThroughput(n: number): Promise<Map<string, number>> {
  registerThroughputBenches(n);
  // Silence mitata's own rendering by overriding its print hook with a no-op;
  // the benchmark data is still returned for our own table.
  const opts = { print: () => undefined } as unknown as Parameters<
    typeof run
  >[0];
  const result = (await run(opts)) as unknown as MitataResult;
  return new Map(
    result.benchmarks.map((b) => [
      b.alias,
      1e9 / (b.runs[0]?.stats.avg ?? NaN),
    ]),
  );
}

async function main(): Promise<void> {
  const require = createRequire(import.meta.url);
  const version = (require("distillate/package.json") as { version: string })
    .version;
  const banner = envBanner();

  const spaceTable = spaceAccuracyTable(comparisonRows(CAPACITIES));
  const cardTable = cardinalityTable(
    cardinalityRows(HLL_PRECISION, HLL_CARDINALITIES),
  );
  const scalTable = scalableTable(
    scalableRows(SCALABLE_INITIAL, SCALABLE_KEY_COUNTS),
  );
  const cuckTable = cuckooTable(cuckooRows(CUCKOO_KEY_COUNTS));
  const cmTable = countMinTable(countMinRows(COUNTMIN_KEY_COUNTS));
  const tput = throughputTable(await collectThroughput(THROUGHPUT_CAPACITY));

  console.log(banner);
  console.log("\n" + spaceTable);
  console.log("\n" + cardTable);
  console.log("\n" + scalTable);
  console.log("\n" + cuckTable);
  console.log("\n" + cmTable);
  console.log("\n" + tput);

  const md = renderResults({
    banner,
    version,
    date: new Date().toLocaleDateString("en-CA"),
    targetFpr: TARGET_FPR,
    throughputCapacity: THROUGHPUT_CAPACITY,
    spaceTable,
    cardinalityTable: cardTable,
    scalableTable: scalTable,
    cuckooTable: cuckTable,
    countMinTable: cmTable,
    throughputTable: tput,
  });
  writeFileSync(new URL("../RESULTS.md", import.meta.url), md);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
