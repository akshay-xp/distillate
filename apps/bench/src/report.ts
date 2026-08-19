import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { run } from "mitata";

import { comparisonRows } from "./compare.js";
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

export interface ResultsOptions {
  banner: string;
  version: string;
  date: string;
  targetFpr: number;
  throughputCapacity: number;
  spaceTable: string;
  throughputTable: string;
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
    `## Throughput (n = ${capacityLabel(opts.throughputCapacity)})`,
    "",
    "Absolute throughput is machine-relative: it depends on the CPU, the runtime, and the load on the box at measurement time.",
    "Compare the ratios between rows, not these figures against a run on another machine.",
    "",
    opts.throughputTable,
    "",
  ].join("\n");
}

function ops(v: number): string {
  return v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(2)} M ops/s`
    : `${(v / 1_000).toFixed(0)} k ops/s`;
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
  const tput = throughputTable(await collectThroughput(THROUGHPUT_CAPACITY));

  console.log(banner);
  console.log("\n" + spaceTable);
  console.log("\n" + tput);

  const md = renderResults({
    banner,
    version,
    date: new Date().toLocaleDateString("en-CA"),
    targetFpr: TARGET_FPR,
    throughputCapacity: THROUGHPUT_CAPACITY,
    spaceTable,
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
