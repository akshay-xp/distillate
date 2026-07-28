import { expect, test } from "vitest";

import { accuracyRows, FUSE16_FPR, FUSE8_FPR } from "../../bench/accuracy.js";

test("accuracyRows reports design fields for all four structures", () => {
  const rows = accuracyRows([10000]);
  expect(rows.map((r) => r.structure)).toEqual([
    "bloom",
    "blocked",
    "fuse8",
    "fuse16",
  ]);
  expect(rows.map((r) => r.n)).toEqual([10000, 10000, 10000, 10000]);
  expect(rows.map((r) => r.targetFpr)).toEqual([
    0.01,
    0.01,
    FUSE8_FPR,
    FUSE16_FPR,
  ]);
  expect(rows.every((r) => r.bitsPerKey > 0)).toBe(true);

  const fuse8 = rows.find((r) => r.structure === "fuse8");
  const fuse16 = rows.find((r) => r.structure === "fuse16");
  expect(fuse8).toBeDefined();
  expect(fuse16).toBeDefined();
  if (fuse8 && fuse16) {
    expect(fuse16.bitsPerKey).toBe(2 * fuse8.bitsPerKey);
  }
});
