import { CuckooFilter as IncumbentCuckoo } from "bloom-filters";
import { CuckooFilter, CuckooFullError } from "distillate/cuckoo";

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
