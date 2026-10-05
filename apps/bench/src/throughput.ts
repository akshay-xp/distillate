import { BlockedBloomFilter } from "distillate/blocked";
import { BinaryFuse16, BinaryFuse8 } from "distillate/fuse";
import { bench, do_not_optimize, run } from "mitata";

import { adapters, TARGET_FPR } from "./adapters.js";
import {
  cardinalityAdapters,
  HLL_BENCH_KEYS,
  HLL_PRECISION,
} from "./cardinality.js";
import type { CardinalityAdapter } from "./cardinality.js";
import { benchLookup, cycle, hitMissPools } from "./harness.js";

function registerCardinalityBenches(a: CardinalityAdapter, p: number): void {
  const hit = hitMissPools(HLL_BENCH_KEYS).hit;
  const empty = a.create(p);
  const nextAdd = cycle(hit);
  bench(`${a.benchLabel} add`, () => {
    empty.add(nextAdd());
  });

  const built = a.create(p);
  for (const key of hit) built.add(key);
  bench(`${a.benchLabel} count`, () => {
    do_not_optimize(built.count());
  });
}

const STANDALONE = ["blocked", "fuse8", "fuse16"];

/** Every library with throughput benches, in the order the table lists them. */
export function throughputNames(): string[] {
  return [
    ...adapters.map((a) => a.name),
    ...STANDALONE,
    ...cardinalityAdapters.map((a) => a.benchLabel),
  ];
}

/** Register the throughput benches of one library from {@link throughputNames}. */
export function registerThroughputBench(name: string, n: number): void {
  const { hit, miss } = hitMissPools(n);

  const adapter = adapters.find((a) => a.name === name);
  if (adapter) {
    const empty = adapter.create(n);
    const nextAdd = cycle(hit);
    bench(`${name} add`, () => {
      empty.add(nextAdd());
    });
    const built = adapter.build(hit);
    benchLookup(`${name} has (hit)`, built, hit);
    benchLookup(`${name} has (miss)`, built, miss);
    return;
  }

  if (STANDALONE.includes(name)) {
    let built;
    if (name === "blocked") {
      built = BlockedBloomFilter.create(n, TARGET_FPR);
      for (const key of hit) built.add(key);
    } else {
      built = name === "fuse8" ? BinaryFuse8.from(hit) : BinaryFuse16.from(hit);
    }
    benchLookup(`${name} has (hit)`, built, hit);
    benchLookup(`${name} has (miss)`, built, miss);
    return;
  }

  const sketch = cardinalityAdapters.find((a) => a.benchLabel === name);
  if (!sketch) throw new Error(`no throughput benches for ${name}`);
  registerCardinalityBenches(sketch, HLL_PRECISION);
}

interface MitataResult {
  benchmarks: { alias: string; runs: { stats: { avg: number } }[] }[];
}

/** Run one library's throughput benches and report ops/sec per label. */
export async function measureThroughput(
  name: string,
  n: number,
): Promise<[string, number][]> {
  registerThroughputBench(name, n);
  // Silence mitata's own rendering by overriding its print hook with a no-op;
  // the benchmark data is still returned for our own table.
  const opts = { print: () => undefined } as unknown as Parameters<
    typeof run
  >[0];
  const result = (await run(opts)) as unknown as MitataResult;
  return result.benchmarks.map((b) => [
    b.alias,
    1e9 / (b.runs[0]?.stats.avg ?? NaN),
  ]);
}
