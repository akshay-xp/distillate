import { BlockedBloomFilter } from "../src/blocked/blocked.js";
import { BloomFilter } from "../src/bloom/bloom.js";
import { BinaryFuse16, BinaryFuse8 } from "../src/fuse/fuse.js";

import { hitMissPools, measureFpr } from "./harness.js";

export const MISS = 1_000_000;
export const BLOOM_FPR = 0.01;
export const FUSE8_FPR = 2 ** -8;
export const FUSE16_FPR = 2 ** -16;

export interface AccuracyRow {
  structure: string;
  n: number;
  targetFpr: number;
  measuredFpr: number;
  bitsPerKey: number;
}

export function accuracyRows(sizes: number[]): AccuracyRow[] {
  const rows: AccuracyRow[] = [];
  const miss = hitMissPools(MISS).miss;
  for (const n of sizes) {
    const hit = hitMissPools(n).hit;

    const bloom = BloomFilter.create(n, BLOOM_FPR);
    const blocked = BlockedBloomFilter.create(n, BLOOM_FPR);
    for (const k of hit) {
      bloom.add(k);
      blocked.add(k);
    }
    const fuse8 = BinaryFuse8.from(hit);
    const fuse16 = BinaryFuse16.from(hit);

    rows.push(
      {
        structure: "bloom",
        n,
        targetFpr: BLOOM_FPR,
        measuredFpr: measureFpr(bloom, miss),
        bitsPerKey: bloom.bitsPerKey,
      },
      {
        structure: "blocked",
        n,
        targetFpr: BLOOM_FPR,
        measuredFpr: measureFpr(blocked, miss),
        bitsPerKey: blocked.bitsPerKey,
      },
      {
        structure: "fuse8",
        n,
        targetFpr: FUSE8_FPR,
        measuredFpr: measureFpr(fuse8, miss),
        bitsPerKey: fuse8.bitsPerKey,
      },
      {
        structure: "fuse16",
        n,
        targetFpr: FUSE16_FPR,
        measuredFpr: measureFpr(fuse16, miss),
        bitsPerKey: fuse16.bitsPerKey,
      },
    );
  }
  return rows;
}

const COLS: { header: string; of: (r: AccuracyRow) => string }[] = [
  { header: "structure", of: (r) => r.structure },
  { header: "n", of: (r) => r.n.toLocaleString("en-US") },
  { header: "target", of: (r) => r.targetFpr.toExponential(2) },
  { header: "measured", of: (r) => r.measuredFpr.toExponential(2) },
  { header: "bits/key", of: (r) => r.bitsPerKey.toFixed(2) },
];

export function formatRows(rows: AccuracyRow[]): string {
  const lines = [
    COLS.map((c) => c.header),
    ...rows.map((r) => COLS.map((c) => c.of(r))),
  ];
  const widths = COLS.map((_, i) =>
    Math.max(...lines.map((line) => line[i]?.length ?? 0)),
  );
  return lines
    .map((line) =>
      line.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  "),
    )
    .join("\n");
}
