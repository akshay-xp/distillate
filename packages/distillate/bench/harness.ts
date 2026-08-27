/// <reference types="node" />
import { bench, do_not_optimize } from "mitata";
import * as os from "node:os";
import { performance, PerformanceObserver } from "node:perf_hooks";

export interface Queryable {
  has(key: string): boolean;
}

// Enough windows for a slow machine to settle, few enough that a loop whose
// readings never settle still finishes.
const MAX_WARMUP_WINDOWS = 20;

// How many times the whole measurement is repeated before the lowest is taken.
const ATTEMPTS = 3;

// Enough turns for a queued batch of entries to arrive, few enough that a
// process collecting continuously still finishes.
const MAX_SETTLE_TICKS = 20;

// Calls made before the count starts, to let V8 optimise the loop. Ten times
// the ~50k measured to be enough even with coverage instrumentation on.
const WARMUP_CALLS = 500_000;

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
 * Heap bytes allocated per call of `fn`: the median of `rounds` windows of
 * `ops` calls each, and the lowest such median over a few repeats. Counts
 * garbage, not just what survives, which is the point: an object allocated and
 * dropped every call is GC pressure even though it retains nothing.
 *
 * Two things make a single window untrustworthy, and the median answers both.
 * `heapUsed` is process-wide, so a neighbouring test inflates a reading (a
 * zero-allocation loop measured 0 bytes/op alone and 36 right after a test that
 * built a million strings). And a collection inside the window *frees* memory,
 * so a reading can come out negative: the same allocating loop produced
 * `[73.4, -16.8, 19.7, 73.6, 74.7, -111.4]`. Neither the minimum *of windows*
 * nor the mean survives that; the median lands at ~73 where the true cost is
 * ~73.
 *
 * Keep `ops` small enough that most windows stay under the young-generation
 * threshold and no collection fires at all: 50000 is a good default. At that
 * size a non-allocating loop reads exactly 0 on every round.
 *
 * Warm-up runs full-size windows until two consecutive readings agree, rather
 * than a fixed call count. A cold loop allocates while V8 optimises it, and how
 * long that takes scales with the machine: a fixed 5000-call warm-up left the
 * first window at 33 to 49 bytes/op here and several windows inflated on a CI
 * runner, where the median then reported 35 to 40 for a loop allocating
 * nothing.
 *
 * That rule is necessary but not sufficient, which is why the whole
 * measurement is repeated and the lowest median kept. The rule waits for two
 * consecutive readings to agree, and a loop still warming supplies those as
 * readily as a settled one: given a flat enough warm-up the rule lets go early
 * and every round of the median then reads the warming cost. A `add()` that
 * allocates nothing failed CI at a stable 40.006 bytes/op that way and passed
 * on rerun with no code change.
 *
 * Taking the lowest *median* is safe where taking the lowest window is not.
 * Window minima chase collection noise; medians of a loop that genuinely
 * allocates all land on its true cost, attempt after attempt, so the minimum
 * lands there too. Only a cost that stops appearing, which is what warm-up is,
 * can be lowered by repeating.
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
  let best = Infinity;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    best = Math.min(best, measureOnce(fn, ops, rounds));
  }
  return best;
}

function measureOnce(fn: () => void, ops: number, rounds: number): number {
  const window = (): number => {
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < ops; i++) fn();
    const after = process.memoryUsage().heapUsed;
    return (after - before) / ops;
  };

  // Warm up in full windows until two consecutive readings agree, so a slow
  // machine warms for longer instead of measuring its own JIT.
  let previous = window();
  for (let warmups = 1; warmups < MAX_WARMUP_WINDOWS; warmups++) {
    const current = window();
    if (Math.abs(current - previous) < 1) break;
    previous = current;
  }

  const samples: number[] = [];
  for (let round = 0; round < rounds; round++) samples.push(window());

  samples.sort((a, b) => a - b);
  return Math.max(0, samples[samples.length >> 1] ?? 0);
}

/**
 * Garbage collections triggered by `ops` calls of `fn`.
 *
 * A loop that allocates nothing triggers none; a loop allocating one small
 * object per call triggers scavenges in proportion. That makes the two cases
 * unambiguous without a median, a threshold, or a stability rule.
 */
export async function countCollections(
  fn: () => void,
  ops: number,
): Promise<number> {
  let collections = 0;
  // Entries are counted only if the collection began inside the measured
  // window. Without the bound, one that fires after the loop, while the ticks
  // below run and the test runner does its own work, is charged to the loop:
  // that read 1 to 3 collections for a call that allocates nothing, but only
  // when the whole suite ran and there was other work to trigger it.
  let from = Infinity;
  let to = Infinity;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime >= from && entry.startTime <= to) collections++;
    }
  });
  observer.observe({ entryTypes: ["gc"] });

  // Entries are delivered on a macrotask turn, not a microtask: `await null`
  // and `setImmediate` both leave the count at zero where `setTimeout` does
  // not. So the count is final only once a turn passes without it moving.
  const settle = async (): Promise<void> => {
    let previous = -1;
    for (let i = 0; i < MAX_SETTLE_TICKS && previous !== collections; i++) {
      previous = collections;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  };

  // A loop allocates while V8 is still optimising it, which is not its
  // steady-state cost, so warm it before the window opens.
  //
  // Both loops call `fn` directly, and the duplication is deliberate: putting
  // them behind a shared helper adds a frame between the loop and `fn`, and
  // that is what stops `fn` being inlined. The instrument this replaced read
  // 40 bytes/op for a call that allocates nothing precisely because it called
  // `fn` through its own machinery.
  for (let i = 0; i < WARMUP_CALLS; i++) fn();

  from = performance.now();
  for (let i = 0; i < ops; i++) fn();
  to = performance.now();
  await settle();

  observer.disconnect();
  return collections;
}
