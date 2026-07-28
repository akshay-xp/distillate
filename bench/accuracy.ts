import { BlockedBloomFilter } from "../src/blocked/blocked.js";
import { BloomFilter } from "../src/bloom/bloom.js";
import { BinaryFuse16, BinaryFuse8 } from "../src/fuse/fuse.js";

import { hitMissPools } from "./harness.js";

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
        measuredFpr: 0,
        bitsPerKey: bloom.bitsPerKey,
      },
      {
        structure: "blocked",
        n,
        targetFpr: BLOOM_FPR,
        measuredFpr: 0,
        bitsPerKey: blocked.bitsPerKey,
      },
      {
        structure: "fuse8",
        n,
        targetFpr: FUSE8_FPR,
        measuredFpr: 0,
        bitsPerKey: fuse8.bitsPerKey,
      },
      {
        structure: "fuse16",
        n,
        targetFpr: FUSE16_FPR,
        measuredFpr: 0,
        bitsPerKey: fuse16.bitsPerKey,
      },
    );
  }
  return rows;
}
