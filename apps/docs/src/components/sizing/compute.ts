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

export function computeSizing(capacity: number, epsilon: number): SizingReport {
  return {
    bloom: classicSizing(capacity, epsilon),
    blocked: blockedSizing(capacity, epsilon),
    fuse8: fuseSizing(capacity, 8),
    fuse16: fuseSizing(capacity, 16),
  };
}
