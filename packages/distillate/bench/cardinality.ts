import { HyperLogLog } from "../src/hll/hll.js";

import { hitMissPools } from "./harness.js";

export interface CardinalityRow {
  /** Precision the sketch was built at. */
  p: number;
  /** Distinct keys added. */
  n: number;
  /** Analytic relative standard error, `1.04 / sqrt(2 ** p)`. */
  targetError: number;
  /** Observed relative error of the reported count. */
  measuredError: number;
  /** Signed relative error, kept so bias can be told from noise. */
  signedError: number;
  /** Serialized size of the sketch. */
  bytes: number;
}

/**
 * Measures a HyperLogLog against theory across precisions and cardinalities.
 *
 * Size is the serialized length rather than a heap reading, following the rule
 * in `docs/engineering.md` that space is reported analytically: it is exact,
 * reproducible across runtimes, and not at the mercy of when GC last ran.
 *
 * @param precisions - Precisions to build at.
 * @param sizes - Distinct key counts to measure at.
 * @returns One row per precision and cardinality, ordered by precision.
 */
export function cardinalityRows(
  precisions: number[],
  sizes: number[],
): CardinalityRow[] {
  const rows: CardinalityRow[] = [];
  for (const p of precisions) {
    for (const n of sizes) {
      const keys = hitMissPools(n).hit;
      const sketch = new HyperLogLog({ p });
      for (const key of keys) sketch.add(key);

      const signedError = (sketch.count() - n) / n;
      rows.push({
        p,
        n,
        targetError: 1.04 / Math.sqrt(2 ** p),
        measuredError: Math.abs(signedError),
        signedError,
        bytes: sketch.toBytes().length,
      });
    }
  }
  return rows;
}

const COLS: { header: string; of: (r: CardinalityRow) => string }[] = [
  { header: "p", of: (r) => String(r.p) },
  { header: "n", of: (r) => r.n.toLocaleString("en-US") },
  { header: "target", of: (r) => r.targetError.toExponential(2) },
  { header: "measured", of: (r) => r.measuredError.toExponential(2) },
  { header: "bytes", of: (r) => r.bytes.toLocaleString("en-US") },
];

export function formatCardinalityRows(rows: CardinalityRow[]): string {
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
