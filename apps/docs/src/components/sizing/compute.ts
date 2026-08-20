import { blockedBitsPerKey, ParamError } from "distillate/blocked";
import { bloomSizing } from "distillate/bloom";
import { fuseBitsPerKey } from "distillate/fuse";

/** Space a structure needs for the requested capacity, or why it cannot say. */
export type StructureResult =
  | { ok: true; bitsPerKey: number; totalBytes: number; note?: string }
  | { ok: false; message: string };

/** What the calculator shows for one capacity and target rate. */
export interface SizingReport {
  bloom: StructureResult;
  blocked: StructureResult;
  fuse8: StructureResult;
  fuse16: StructureResult;
}

function classicSizing(capacity: number, epsilon: number): StructureResult {
  const { m } = bloomSizing(capacity, epsilon);
  return { ok: true, bitsPerKey: m / capacity, totalBytes: Math.ceil(m / 8) };
}

function blockedSizing(capacity: number, epsilon: number): StructureResult {
  let bitsPerKey: number;
  try {
    bitsPerKey = blockedBitsPerKey(epsilon);
  } catch (error) {
    // The solver stops at 128 bits/key, around 1e-8. Below that it rejects
    // rather than under-provision, which is an answer the page should show.
    if (error instanceof ParamError)
      return { ok: false, message: error.message };
    throw error;
  }
  return {
    ok: true,
    bitsPerKey,
    totalBytes: Math.ceil((bitsPerKey * capacity) / 8),
  };
}

/** Largest capacity worth pricing; beyond this the answer is "not in memory". */
const MAX_CAPACITY = 1e12;

const CAPACITY_MESSAGE =
  "Capacity must be a whole number of keys between 1 and 1e12.";
const RATE_MESSAGE =
  "Target rate must be a number greater than 0 and less than 1, for example 0.01 for 1%.";

// The form hands over strings, so accept those as well as numbers. Anything
// else, including null, undefined, objects, and blanks, is not a number.
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

type Inputs =
  | { ok: true; capacity: number; epsilon: number }
  | { ok: false; message: string };

function validate(capacity: unknown, epsilon: unknown): Inputs {
  const n = toNumber(capacity);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CAPACITY) {
    return { ok: false, message: CAPACITY_MESSAGE };
  }
  const eps = toNumber(epsilon);
  if (!Number.isFinite(eps) || eps <= 0 || eps >= 1) {
    return { ok: false, message: RATE_MESSAGE };
  }
  return { ok: true, capacity: n, epsilon: eps };
}

const FUSE_NOTE =
  "Static: built once from the whole key set, then immutable. It rejects inserts after the build, and takes no target epsilon; the rate is fixed by fingerprint width.";

function fuseSizing(capacity: number, width: 8 | 16): StructureResult {
  const bitsPerKey = fuseBitsPerKey(capacity, width);
  return {
    ok: true,
    bitsPerKey,
    totalBytes: Math.ceil((bitsPerKey * capacity) / 8),
    note: FUSE_NOTE,
  };
}

export function computeSizing(
  capacity: unknown,
  epsilon: unknown,
): SizingReport {
  const input = validate(capacity, epsilon);
  if (!input.ok) {
    const failed = { ok: false, message: input.message } as const;
    return { bloom: failed, blocked: failed, fuse8: failed, fuse16: failed };
  }
  return {
    bloom: classicSizing(input.capacity, input.epsilon),
    blocked: blockedSizing(input.capacity, input.epsilon),
    fuse8: fuseSizing(input.capacity, 8),
    fuse16: fuseSizing(input.capacity, 16),
  };
}
