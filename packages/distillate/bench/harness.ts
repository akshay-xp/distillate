/// <reference types="node" />
import { bench, do_not_optimize } from "mitata";
import * as os from "node:os";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { getHeapSpaceStatistics } from "node:v8";

export interface Queryable {
  has(key: string): boolean;
}

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
 * Most young-generation bytes a probed call may allocate in steady state: one
 * 16-byte object every 8 calls. Clean code reads at most 0.45 (`fuse.has` over
 * keys of varying length) and amortised growth 0.20 (RIBLT); the boxing fixed in
 * 76bc6c3 reads 7 to 16.
 */
export const ALLOCATION_LIMIT = 2;

export interface Allocation {
  /** Collections that began inside the measured window. */
  collections: number;
  /** Young-generation bytes the window allocated, per call. */
  bytesPerCall: number;
}

// Bytes in use in the young generation, where every short-lived object starts.
function youngBytes(): number {
  return (
    getHeapSpaceStatistics().find((s) => s.space_name === "new_space")
      ?.space_used_size ?? 0
  );
}

/**
 * What `ops` calls of `fn` allocate once warm: the collections that began
 * inside the window, and the young-generation bytes it allocated per call.
 *
 * Collections alone see only garbage that fills the young generation. How much
 * that takes depends on how far V8 has grown it, so the same allocating loop
 * measures 25 collections in a quiet process and 5 in a busy one, and a loop
 * allocating less than the young generation holds measures none: the boxing
 * fixed in 76bc6c3, about 7 to 16 bytes per RIBLT hand-off, passed under
 * coverage with the young generation pinned at 1 MB. So the window also reads
 * the young generation's used bytes either side of the loop, less what a read
 * itself allocates. Read `collections` as a binary and `bytesPerCall` against
 * {@link ALLOCATION_LIMIT}.
 *
 * The byte reading avoids what sank the `heapUsed` instrument below. It reads
 * only the young generation, where a call's garbage starts, and the loop is
 * synchronous, so nothing else runs between the two reads. A collection inside
 * the window would make it come out low, or negative, which is why
 * `collections` must also be 0. And it is taken after the warm-up, like the
 * count.
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
 *
 * One window is measured and reported as it stands. Repeating and taking the
 * best was tried, and it is the wrong shape: it hides a caller whose loop V8
 * declines to optimise, which is a real cost rather than noise to average out.
 * It is unnecessary once the loop stops competing for CPU, which is what the
 * dedicated single-worker project in vitest.config.ts is for.
 *
 * `warmup` is for a call heavy enough to optimise in fewer calls, whose state
 * grows with every call: 500k RIBLT hand-offs carry a decoder past a 40 MB
 * buffer doubling that the measured window would then be charged for.
 */
export async function measureAllocation(
  fn: () => void,
  ops: number,
  warmup: number = WARMUP_CALLS,
): Promise<Allocation> {
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
  for (let i = 0; i < warmup; i++) fn();

  await settle();
  collections = 0;

  // Two reads back to back measure what a read itself allocates.
  const idle = youngBytes();
  const calibration = youngBytes() - idle;
  const before = youngBytes();
  from = performance.now();
  for (let i = 0; i < ops; i++) fn();
  to = performance.now();
  const after = youngBytes();
  await settle();

  observer.disconnect();
  return {
    collections,
    bytesPerCall: (after - before - calibration) / ops,
  };
}
