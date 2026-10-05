import { expect, test } from "vitest";

import { distillateBloomAdapter } from "../src/adapters.js";
import {
  KEYLENGTH_ALPHABETS,
  KEYLENGTH_LENGTHS,
  KEYLENGTH_N,
  keyLengthKeys,
  keyLengthRows,
} from "../src/keylength.js";

test("ascii keys are distinct, exactly the length asked for, and all ASCII", () => {
  const keys = keyLengthKeys(16, "ascii", 1000);
  expect(new Set(keys).size).toBe(1000);
  for (const k of keys) {
    expect(k).toHaveLength(16);
    expect(/^[\x00-\x7f]*$/.test(k)).toBe(true);
  }
});

test("non-ascii keys are distinct, exactly the length asked for, and each carries a non-ASCII char", () => {
  const keys = keyLengthKeys(16, "non-ascii", 1000);
  expect(new Set(keys).size).toBe(1000);
  for (const k of keys) {
    expect(k).toHaveLength(16);
    expect(/[^\x00-\x7f]/.test(k)).toBe(true);
  }
});

test("keyLengthRows times add and has for each adapter, length and alphabet", () => {
  const rows = keyLengthRows([8], ["ascii"], 1000, [distillateBloomAdapter]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    name: "distillate/bloom",
    length: 8,
    alphabet: "ascii",
  });
  for (const ops of [rows[0]!.addOpsPerSec, rows[0]!.hasOpsPerSec]) {
    expect(Number.isFinite(ops) && ops > 0).toBe(true);
  }
});

test("a full sweep's keys fit in 4 characters, unique, with non-ASCII keys still carrying one", () => {
  for (const alphabet of KEYLENGTH_ALPHABETS) {
    const keys = keyLengthKeys(4, alphabet, KEYLENGTH_N);
    expect(new Set(keys).size).toBe(KEYLENGTH_N);
    for (const k of keys) expect(k).toHaveLength(4);
    if (alphabet === "non-ascii") {
      expect(keys.every((k) => /[^\x00-\x7f]/.test(k))).toBe(true);
    }
  }
});

test("the sweep covers short keys and both sides of the 12-character cap and 13-character rope threshold", () => {
  for (const length of [4, 12, 13]) {
    expect(KEYLENGTH_LENGTHS).toContain(length);
  }
});
