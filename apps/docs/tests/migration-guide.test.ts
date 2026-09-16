import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { parseTable } from "../src/tables.js";

const GUIDE = readFileSync(
  fileURLToPath(
    new URL(
      "../src/content/docs/guides/migrating-from-bloom-filters.md",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("the sketch mapping covers every call a migrating reader makes", () => {
  const rows = parseTable(GUIDE, "The cardinality sketch");
  expect(rows).toHaveLength(6);

  const incumbent = rows.map(([from]) => from);
  for (const call of [
    "new HyperLogLog(nbRegisters)",
    "update",
    "count",
    "merge",
    "saveAsJSON",
  ]) {
    expect(
      incumbent.some((cell) => cell.includes(call)),
      `no row maps ${call}`,
    ).toBe(true);
  }

  // Every row has to land somewhere; a blank right cell is an unmapped call.
  for (const [from, to] of rows) {
    expect(to.trim(), `${from} maps to nothing`).not.toBe("");
  }
});
