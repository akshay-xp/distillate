/// <reference types="node" />
import * as os from "node:os";

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

export function measureFpr(
  filter: { has(key: string): boolean },
  miss: readonly string[],
): number {
  let hits = 0;
  for (const key of miss) if (filter.has(key)) hits++;
  return hits / miss.length;
}

export function cycle<T>(pool: readonly T[]): () => T {
  let i = 0;
  return () => pool[i++ % pool.length]!;
}
