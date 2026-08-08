import { BlockedBloomFilter } from "distillate/blocked";
import { BinaryFuse16, BinaryFuse8 } from "distillate/fuse";

import { adapters, TARGET_FPR } from "./adapters.js";
import { hitMissPools, measureFpr } from "./harness.js";

export const MISS = 1_000_000;
export const FUSE8_FPR = 2 ** -8;
export const FUSE16_FPR = 2 ** -16;

export interface ComparisonRow {
  name: string;
  n: number;
  targetFpr: number;
  measuredFpr: number;
  bitsPerKey: number;
  standalone: boolean;
}

export function classicBloomRows(capacities: number[]): ComparisonRow[] {
  const miss = hitMissPools(MISS).miss;
  const rows: ComparisonRow[] = [];
  for (const n of capacities) {
    const hit = hitMissPools(n).hit;
    for (const adapter of adapters) {
      const f = adapter.build(hit);
      rows.push({
        name: adapter.name,
        n,
        targetFpr: TARGET_FPR,
        measuredFpr: measureFpr(f, miss),
        bitsPerKey: f.bitsPerKey,
        standalone: false,
      });
    }
  }
  return rows;
}

export function comparisonRows(capacities: number[]): ComparisonRow[] {
  return capacities.flatMap((n) => [
    ...classicBloomRows([n]),
    ...distillateOnlyRows([n]),
  ]);
}

export function distillateOnlyRows(capacities: number[]): ComparisonRow[] {
  const miss = hitMissPools(MISS).miss;
  const rows: ComparisonRow[] = [];
  for (const n of capacities) {
    const hit = hitMissPools(n).hit;

    const blocked = BlockedBloomFilter.create(n, TARGET_FPR);
    for (const key of hit) blocked.add(key);

    const row = (
      name: string,
      targetFpr: number,
      filter: { has(key: string): boolean; bitsPerKey: number },
    ): ComparisonRow => ({
      name,
      n,
      targetFpr,
      measuredFpr: measureFpr(filter, miss),
      bitsPerKey: filter.bitsPerKey,
      standalone: true,
    });

    rows.push(
      row("blocked", TARGET_FPR, blocked),
      row("fuse8", FUSE8_FPR, BinaryFuse8.from(hit)),
      row("fuse16", FUSE16_FPR, BinaryFuse16.from(hit)),
    );
  }
  return rows;
}
