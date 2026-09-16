import { bench, do_not_optimize } from "mitata";
import * as os from "node:os";

export interface Queryable {
  has(key: string): boolean;
}

export interface Insertable {
  add(key: string): void;
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
  return `distillate-bench | ${runtime()} | ${process.arch} | ${model} | ${String(cpus.length)} cores`;
}

/**
 * The inserted "hit" keys, streamed. Cardinality sweeps run to tens of millions
 * of keys, where materializing the pool costs more memory than the sketches do.
 */
export function* hitKeys(n: number): Generator<string> {
  for (let i = 0; i < n; i++) yield `0:${String(i)}`;
}

export function hitMissPools(n: number): { hit: string[]; miss: string[] } {
  const hit = [...hitKeys(n)];
  const miss = new Array<string>(n);
  for (let i = 0; i < n; i++) miss[i] = `1:${String(i)}`;
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
