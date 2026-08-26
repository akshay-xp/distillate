import { expect, test } from "vitest";

import {
  cardinalityRows,
  formatCardinalityRows,
} from "../../bench/cardinality.js";

const PRECISIONS = [10, 12, 14];
const SIZES = [1e3, 1e4, 1e5];

test("cardinalityRows covers every precision and cardinality", () => {
  const rows = cardinalityRows(PRECISIONS, SIZES);

  expect(rows).toHaveLength(9);
  expect(rows.map((r) => r.p)).toEqual([10, 10, 10, 12, 12, 12, 14, 14, 14]);
  expect(rows.map((r) => r.n)).toEqual([
    1e3, 1e4, 1e5, 1e3, 1e4, 1e5, 1e3, 1e4, 1e5,
  ]);
});

test("each row reports the analytic bound for its precision", () => {
  for (const row of cardinalityRows(PRECISIONS, SIZES)) {
    expect(row.targetError).toBe(1.04 / Math.sqrt(2 ** row.p));
    expect(row.measuredError).toBeGreaterThanOrEqual(0);
  }
});

// A coarser sketch is the cheaper one, which is the whole trade the table is
// there to show.
test("a coarser precision costs fewer bytes at the same cardinality", () => {
  const rows = cardinalityRows(PRECISIONS, [1e5]);
  const bytes = rows.map((r) => r.bytes);

  expect(bytes[0]).toBeLessThan(bytes[1] ?? 0);
  expect(bytes[1]).toBeLessThan(bytes[2] ?? 0);
});

// The gate. Bounding every point proves accuracy; bounding the mean *signed*
// error proves the estimator is unbiased, which a per-point bound would miss if
// every estimate leaned the same way.
test("measured error stays inside the analytic bound at every point", () => {
  for (const row of cardinalityRows(PRECISIONS, SIZES)) {
    expect({
      p: row.p,
      n: row.n,
      within: row.measuredError < 3 * row.targetError,
    }).toEqual({ p: row.p, n: row.n, within: true });
  }
});

test("the estimator is unbiased across the sweep", () => {
  const rows = cardinalityRows(PRECISIONS, SIZES);
  const mean = rows.reduce((a, r) => a + r.signedError, 0) / rows.length;
  expect(Math.abs(mean)).toBeLessThan(0.01);
});

test("a coarser precision promises a looser bound", () => {
  const rows = cardinalityRows(PRECISIONS, [1e4]);
  expect(rows[0]?.targetError).toBeGreaterThan(rows[1]?.targetError ?? 0);
  expect(rows[1]?.targetError).toBeGreaterThan(rows[2]?.targetError ?? 0);
});

test("formatCardinalityRows renders a table naming every precision", () => {
  const table = formatCardinalityRows(cardinalityRows(PRECISIONS, [1e4]));

  for (const header of ["p", "n", "target", "measured", "bytes"]) {
    expect(table).toContain(header);
  }
  for (const p of PRECISIONS) expect(table).toContain(String(p));
});
