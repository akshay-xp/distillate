import { bloomSizing } from "distillate/bloom";

/** Space a structure needs for the requested capacity, or why it cannot say. */
export type StructureResult =
  | { ok: true; bitsPerKey: number; totalBytes: number; note?: string }
  | { ok: false; message: string };

/** What the calculator shows for one capacity and target rate. */
export interface SizingReport {
  bloom: StructureResult;
}

export function computeSizing(capacity: number, epsilon: number): SizingReport {
  const { m } = bloomSizing(capacity, epsilon);
  return {
    bloom: {
      ok: true,
      bitsPerKey: m / capacity,
      totalBytes: Math.ceil(m / 8),
    },
  };
}
