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

test("formatCardinalityRows renders a table naming every precision", () => {
  const table = formatCardinalityRows(cardinalityRows(PRECISIONS, [1e4]));

  for (const header of ["p", "n", "target", "measured", "bytes"]) {
    expect(table).toContain(header);
  }
  for (const p of PRECISIONS) expect(table).toContain(String(p));
});
