import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { blockedFprAt } from "distillate/blocked";
import { bloomSizing } from "distillate/bloom";
import { HyperLogLog } from "distillate/hll";
import { expect, test } from "vitest";

import { parseTable } from "../src/tables.js";

const GUIDES = new URL("../src/content/docs/guides/", import.meta.url);

function guide(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, GUIDES)), "utf8");
}

/** A cell as a number, tolerating the thousands separators docs use. */
function num(cell: string): number {
  return Number(cell.replace(/[,%]/g, "").replace(/x$/, ""));
}

const FIXTURE = [
  "## First",
  "",
  "| a   | b   |",
  "| --- | --- |",
  "| 1   | 2   |",
  "",
  "## Second",
  "",
  "| c   |",
  "| --- |",
  "| 3   |",
  "",
].join("\n");

test("parseTable returns the data rows under the heading it is given", () => {
  expect(parseTable(FIXTURE, "First")).toEqual([["1", "2"]]);
  expect(parseTable(FIXTURE, "Second")).toEqual([["3"]]);
});

// n cancels out of bits/key, so any n serves; a million keeps the arithmetic
// clear of the integer rounding a tiny filter would show.
const N = 1_000_000;

test("the classic sizing table matches bloomSizing", () => {
  const rows = parseTable(
    guide("sizing.md"),
    "Classic Bloom: `bloomSizing(n, epsilon)`",
  );
  expect(rows).toHaveLength(7);

  for (const [epsilon, bitsPerKey, k] of rows) {
    const sizing = bloomSizing(N, num(epsilon));
    expect(Number((sizing.m / N).toFixed(2)), `bits/key at ${epsilon}`).toBe(
      num(bitsPerKey),
    );
    expect(sizing.k, `k at ${epsilon}`).toBe(num(k));
  }
});

test("the blocked comparison table matches the library", () => {
  const rows = parseTable(guide("sizing.md"), "Below 1e-5, do not use blocked");
  expect(rows).toHaveLength(6);

  for (const [bitsPerKey, classicFpr, blockedFpr, ratio] of rows) {
    const bits = num(bitsPerKey);

    // There is no exported bloomFprAt, so the classic column is checked by
    // inverting the helper there is: the rate it claims must be the rate that
    // asks for this many bits per key.
    expect(
      Math.round(bloomSizing(N, num(classicFpr)).m / N),
      `classic FPR at ${bitsPerKey} bits/key`,
    ).toBe(bits);

    // The column is written to three significant figures, so that is what it
    // is held to.
    expect(
      Number(blockedFprAt(bits).toPrecision(3)),
      `blocked FPR at ${bitsPerKey} bits/key`,
    ).toBe(num(blockedFpr));

    // The ratio column is printed to two or three significant figures
    // depending on the row, so it is held to a relative bound rather than to
    // a fixed number of places.
    const actual = num(blockedFpr) / num(classicFpr);
    expect(
      Math.abs(actual - num(ratio)) / num(ratio),
      `ratio at ${bitsPerKey} bits/key, table says ${ratio}, columns give ${actual.toFixed(1)}`,
    ).toBeLessThan(0.05);
  }
});

test("the precision table matches the sketch", () => {
  const rows = parseTable(guide("hll.md"), "Choose a precision");
  expect(rows).toHaveLength(3);

  for (const [precision, registers, bytes, error] of rows) {
    const p = num(precision);
    const sketch = new HyperLogLog({ p });

    expect(2 ** p, `registers at p=${precision}`).toBe(num(registers));
    expect((2 ** p * 6) / 8, `bytes at p=${precision}`).toBe(num(bytes));
    expect(
      Number((sketch.standardError * 100).toFixed(2)),
      `standard error at p=${precision}`,
    ).toBe(num(error));
  }
});

// The fuse class table under "Binary Fuse" is deliberately not covered. Its
// `~0.39%` and `~1/65536` are `2 ** -width` for the widths the table itself
// names, not figures the library computes, so checking them would only
// restate the table's own arithmetic back at it.
