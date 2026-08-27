/// <reference types="node" />
import { bench, do_not_optimize } from "mitata";
import * as os from "node:os";
import { performance, PerformanceObserver } from "node:perf_hooks";

export interface Queryable {
  has(key: string): boolean;
}

// Enough turns for a queued batch of entries to arrive, few enough that a
// process collecting continuously still finishes.
const MAX_SETTLE_TICKS = 20;

// Calls made before the count starts, to let V8 optimise the loop. Ten times
// the ~50k measured to be enough even with coverage instrumentation on.
const WARMUP_CALLS = 500_000;

// How many windows to try before giving up on finding a clean one. Reached
// only when the loop really does allocate, so the cost is paid on failure.
const MAX_WINDOWS = 40;

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
 * Garbage collections triggered by `ops` calls of `fn`.
 *
 * A loop that allocates nothing triggers none; a loop allocating one small
 * object per call triggers scavenges in proportion. That makes the two cases
 * unambiguous without a median, a threshold, or a stability rule.
 *
 * Read the result as a binary, not a magnitude. How many collections a given
 * amount of garbage causes depends on how far V8 has grown the young
 * generation, so the same allocating loop measures 25 collections in a quiet
 * process and 5 in one that has been working for a while.
 *
 * This replaced an instrument that differenced `process.memoryUsage().heapUsed`
 * across a window of calls. Three things went wrong with that, none of them
 * worth rediscovering:
 *
 * - `heapUsed` is process-wide, so a neighbouring test inflates a reading. A
 *   zero-allocation loop measured 0 bytes/op alone and 36 straight after a test
 *   that built a million strings.
 * - A collection inside the window *frees* memory, so a reading can come out
 *   negative. One allocating loop produced `[73.4, -16.8, 19.7, 73.6, 74.7,
 *   -111.4]`, which is why a median was needed to get a usable number at all.
 * - Above all, a heap delta cannot tell a loop V8 has not optimised yet from
 *   one that has settled. Both look like a flat plateau, so a stability rule
 *   releases on the first and reports the warm-up as the answer. That is what
 *   failed CI: an `add()` allocating nothing read a stable 40.006 bytes/op, and
 *   passed on rerun with no code change.
 *
 * Deliberately does not force `global.gc()`. Collecting either side of the
 * window measures surviving heap instead of allocation, which reports nothing
 * for a loop churning garbage and would miss the regression this exists to
 * catch.
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

  // Measured in repeated windows, stopping at the first clean one, and the
  // lowest is returned. This is not a magic number hunt: the claim is that a
  // steady state exists in which the call allocates nothing, so one clean
  // window of `ops` calls settles it, and no number of windows produces one if
  // the call allocates per key.
  //
  // The retry is needed because V8 does not always reach TurboFan promptly. On
  // a loaded machine its compile jobs are starved, and until they land the
  // hash path allocates one encodeInto result object per key. That is the same
  // starvation that made this probe fail CI in the first place, so measuring
  // once and reporting the number cannot work: a single window read non-zero
  // in roughly one full-suite run in five, and every window did in one run in
  // twenty-five. Neither the median nor the lowest of a fixed five separated
  // it, because the noise scales with the window exactly as the signal does.
  const counts: number[] = [];
  for (let window = 0; window < MAX_WINDOWS; window++) {
    collections = 0;
    from = performance.now();
    for (let i = 0; i < ops; i++) fn();
    to = performance.now();
    await settle();

    counts.push(collections);
    from = Infinity;
    to = Infinity;
    if (collections === 0) break;
  }

  const lowest = Math.min(...counts);

  observer.disconnect();
  return lowest;
}
