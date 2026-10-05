import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cardinalityAdapters, cardinalityRows } from "./cardinality.js";
import { countMinAdapters, countMinRows } from "./countmin.js";
import { cuckooAdapters, cuckooRows } from "./cuckoo.js";
import { scalableAdapters, scalableRows } from "./scalable.js";
import { measureThroughput } from "./throughput.js";
import { topKAdapters, topKRows } from "./topk.js";

/**
 * Rows measured one adapter per process, merged back into the order the
 * in-process sweep produced: each key count, then each adapter in turn.
 */
export function interleave<T>(perAdapter: T[][]): T[] {
  const out: T[] = [];
  const rounds = perAdapter[0]?.length ?? 0;
  for (let i = 0; i < rounds; i++) {
    for (const rows of perAdapter) out.push(rows[i]!);
  }
  return out;
}

function only<A extends { name: string }>(
  adapters: A[],
  name: string,
  job: string,
): A[] {
  const picked = adapters.filter((a) => a.name === name);
  if (picked.length === 0) {
    throw new Error(`job ${job} has no adapter named ${name}`);
  }
  return picked;
}

type Job = (adapter: string, args: never) => unknown[] | Promise<unknown[]>;

const JOBS: Record<string, Job> = {
  cardinality: (name, [p, ns]: [number, number[]]) =>
    cardinalityRows(p, ns, only(cardinalityAdapters, name, "cardinality")),
  scalable: (name, [initial, ns]: [number, number[]]) =>
    scalableRows(initial, ns, only(scalableAdapters, name, "scalable")),
  cuckoo: (name, [ns]: [number[]]) =>
    cuckooRows(ns, only(cuckooAdapters, name, "cuckoo")),
  countmin: (name, [ns]: [number[]]) =>
    countMinRows(ns, only(countMinAdapters, name, "countmin")),
  throughput: (name, [n]: [number]) => measureThroughput(name, n),
  topk: (name, [ns]: [number[]]) =>
    topKRows(ns, only(topKAdapters, name, "topk")),
};

const SELF = fileURLToPath(import.meta.url);

/**
 * Run one adapter's share of a section in a fresh node process. Timing every
 * library in one process lets V8 shape shared call sites around whichever
 * runs first, and every library after it is measured slower.
 */
export function runIsolated<T>(
  job: string,
  adapter: string,
  args: unknown[],
): { pid: number; rows: T[] } {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", SELF, job, adapter, JSON.stringify(args)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(r.stderr || `job ${job} failed`);
  return JSON.parse(r.stdout) as { pid: number; rows: T[] };
}

/**
 * A section's rows with every adapter measured in its own process. The runs
 * are sequential: parallel children would compete for the CPU they time.
 */
export function isolatedRows<T>(
  job: string,
  adapters: string[],
  args: unknown[],
): T[] {
  return interleave(adapters.map((a) => runIsolated<T>(job, a, args).rows));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [job = "", adapter = "", args = "[]"] = process.argv.slice(2);
  const run = JOBS[job];
  if (!run) throw new Error(`unknown job ${job}`);
  const rows = await run(adapter, JSON.parse(args) as never);
  process.stdout.write(JSON.stringify({ pid: process.pid, rows }));
}
