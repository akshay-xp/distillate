/// <reference types="node" />
import { bench, do_not_optimize } from "mitata";
import * as os from "node:os";

export interface Queryable {
  has(key: string): boolean;
}

function runtime(): string {
  const versions = process.versions as Record<string, string | undefined>;
  if (versions.bun) return `bun v${versions.bun}`;
  if (versions.deno) return `deno v${versions.deno}`;
  return `node v${process.versions.node}`;
}

export function envBanner(): string {
  const cpus = os.cpus();
  const model = cpus[0]?.model ?? "unknown CPU";
  return `distillate bench | ${runtime()} | ${process.arch} | ${model} | ${String(cpus.length)} cores`;
}

export function hitMissPools(n: number): { hit: string[]; miss: string[] } {
  const hit = new Array<string>(n);
  const miss = new Array<string>(n);
  for (let i = 0; i < n; i++) {
    hit[i] = `0:${String(i)}`;
    miss[i] = `1:${String(i)}`;
  }
  return { hit, miss };
}

export function measureFpr(filter: Queryable, miss: readonly string[]): number {
  let hits = 0;
  for (const key of miss) if (filter.has(key)) hits++;
  return hits / miss.length;
}

export function cycle<T>(pool: readonly T[]): () => T {
  let i = 0;
  return () => pool[i++ % pool.length]!;
}

export function lookupThunk(
  filter: Queryable,
  pool: readonly string[],
): () => void {
  const next = cycle(pool);
  return () => {
    do_not_optimize(filter.has(next()));
  };
}

export function benchLookup(
  name: string,
  filter: Queryable,
  pool: readonly string[],
): void {
  const run = lookupThunk(filter, pool);
  bench(name, () => {
    run();
  });
}

/**
 * Heap bytes allocated per call of `fn`, as the median of `rounds` windows of
 * `ops` calls each. Counts garbage, not just what survives, which is the point:
 * an object allocated and dropped every call is GC pressure even though it
 * retains nothing.
 *
 * Two things make a single window untrustworthy, and the median answers both.
 * `heapUsed` is process-wide, so a neighbouring test inflates a reading (a
 * zero-allocation loop measured 0 bytes/op alone and 36 right after a test that
 * built a million strings). And a collection inside the window *frees* memory,
 * so a reading can come out negative: the same allocating loop produced
 * `[73.4, -16.8, 19.7, 73.6, 74.7, -111.4]`. Neither the minimum nor the mean
 * survives that; the median lands at ~73 where the true cost is ~73.
 *
 * Keep `ops` small enough that most windows stay under the young-generation
 * threshold and no collection fires at all: 50000 is a good default. At that
 * size a non-allocating loop reads exactly 0 on every round.
 *
 * Deliberately does not force `global.gc()`. Collecting either side of the
 * window measures surviving heap instead of allocation, which reports 0 for a
 * loop churning garbage and would miss the regression this exists to catch.
 */
export function measureBytesPerOp(
  fn: () => void,
  ops: number,
  rounds = 7,
): number {
  // Let the loop reach steady state so one-off setup is not charged to it.
  for (let i = 0; i < Math.min(ops, 5_000); i++) fn();

  const samples: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ops; i++) fn();
    const after = process.memoryUsage().heapUsed;
    samples.push((after - before) / ops);
  }

  samples.sort((a, b) => a - b);
  return Math.max(0, samples[samples.length >> 1] ?? 0);
}
