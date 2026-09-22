import { CuckooFilter as IncumbentCuckoo } from "bloom-filters";
import { CuckooFilter, CuckooFullError } from "distillate/cuckoo";

import { TARGET_FPR } from "./adapters.js";
import { hitKeys, hitMissPools, measureFpr } from "./harness.js";

/** The settings a filter actually holds, read back from the library. */
export interface CuckooSettings {
  n: number;
  errorRate: number;
  bucketSize: number;
  maxKicks: number;
  /** Information bits per stored fingerprint. */
  fingerprintBits: number;
}

export interface DeletableFilter {
  /** `false` when the filter refused the key as full. */
  add(key: string): boolean;
  has(key: string): boolean;
  delete(key: string): boolean;
  /** Slot bits allocated for fingerprints. */
  bits(): number;
  settings: CuckooSettings;
}

export interface CuckooAdapter {
  name: string;
  create(n: number, errorRate: number): DeletableFilter;
}

// distillate fixes both; they are the incumbent's defaults too.
const BUCKET_SIZE = 4;
const MAX_KICKS = 500;

export const distillateCuckooAdapter: CuckooAdapter = {
  name: "distillate/cuckoo",
  create(n, errorRate) {
    const f = CuckooFilter.create(n, errorRate);
    return {
      add: (key) => {
        try {
          f.add(key);
          return true;
        } catch (error) {
          if (error instanceof CuckooFullError) return false;
          throw error;
        }
      },
      has: (key) => f.has(key),
      delete: (key) => f.delete(key),
      bits: () => f.m,
      settings: {
        n,
        errorRate: f.epsilon,
        bucketSize: BUCKET_SIZE,
        maxKicks: MAX_KICKS,
        fingerprintBits: f.fingerprintBits,
      },
    };
  },
};

// Its fingerprint is ceil(f / 8) hex characters of a 32-bit hash, stored as a
// JS string, so each character carries 4 bits and its bits are nominal: the
// heap holds a string per slot.
const HEX_BITS = 4;

export const incumbentCuckooAdapter: CuckooAdapter = {
  name: "bloom-filters",
  create(n, errorRate) {
    const f = IncumbentCuckoo.create(n, errorRate);
    return {
      add: (key) => f.add(key),
      has: (key) => f.has(key),
      delete: (key) => f.remove(key),
      bits: () => f.fullSize * f.fingerprintLength * HEX_BITS,
      // It does not store n or the target rate, so those are the arguments.
      settings: {
        n,
        errorRate,
        bucketSize: f.bucketSize,
        maxKicks: f.maxKicks,
        fingerprintBits: f.fingerprintLength * HEX_BITS,
      },
    };
  },
};

export const cuckooAdapters: CuckooAdapter[] = [
  distillateCuckooAdapter,
  incumbentCuckooAdapter,
];

/** One thousand to ten million keys, the same 10M reach as every structure. */
export const CUCKOO_KEY_COUNTS = [
  1_000, 10_000, 100_000, 1_000_000, 10_000_000,
];

// Absent keys (`1:i`), disjoint from hitKeys (`0:i`), shared by every row so
// the FPR columns are measured against the same probes.
const ABSENT = hitMissPools(100_000).miss;

export interface CuckooRow {
  name: string;
  keys: number;
  bitsPerKey: number;
  measuredFpr: number;
  addOpsPerSec: number;
  hasOpsPerSec: number;
  deleteOpsPerSec: number;
  /** Added keys that read absent before any delete. */
  lostAfterBuild: number;
  /** Kept keys that read absent after the first half was deleted. */
  lostAfterDelete: number;
  /** Adds the filter refused as full. */
  refused: number;
}

const rate = (n: number, ms: number): number => n / (ms / 1000);

export function cuckooRows(
  keyCounts: number[],
  adapters: CuckooAdapter[] = cuckooAdapters,
): CuckooRow[] {
  const rows: CuckooRow[] = [];
  for (const n of keyCounts) {
    const half = Math.floor(n / 2);
    for (const adapter of adapters) {
      const f = adapter.create(n, TARGET_FPR);

      let refused = 0;
      let started = performance.now();
      for (const key of hitKeys(n)) if (!f.add(key)) refused++;
      const addMs = performance.now() - started;

      let lostAfterBuild = 0;
      started = performance.now();
      for (const key of hitKeys(n)) if (!f.has(key)) lostAfterBuild++;
      const hasMs = performance.now() - started;

      const measuredFpr = measureFpr(f, ABSENT);

      started = performance.now();
      for (const key of hitKeys(half)) f.delete(key);
      const deleteMs = performance.now() - started;

      // hitKeys yields in order, so the first `half` are the deleted ones.
      let lostAfterDelete = 0;
      let i = 0;
      for (const key of hitKeys(n)) {
        if (i++ >= half && !f.has(key)) lostAfterDelete++;
      }

      rows.push({
        name: adapter.name,
        keys: n,
        bitsPerKey: f.bits() / n,
        measuredFpr,
        addOpsPerSec: rate(n, addMs),
        hasOpsPerSec: rate(n, hasMs),
        deleteOpsPerSec: rate(half, deleteMs),
        lostAfterBuild,
        lostAfterDelete,
        refused,
      });
    }
  }
  return rows;
}
