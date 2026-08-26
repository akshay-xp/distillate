import { expect, test } from "vitest";

import { foldRho } from "../../src/hll/fold.js";

test("folding to the same precision leaves rho alone", () => {
  for (const rho of [7, 1, 63]) {
    expect(foldRho(0, rho, 0)).toBe(rho);
    expect(foldRho(12_345, rho, 0)).toBe(rho);
  }
});

test("a set bit among the reclaimed bits gives its position", () => {
  expect(foldRho(0b100, 1, 3)).toBe(1);
  expect(foldRho(0b010, 1, 3)).toBe(2);
  expect(foldRho(0b001, 1, 3)).toBe(3);
});

// The reclaimed bits sit ahead of everything the source rho measured, so the
// first set bit among them settles the answer on its own.
test("the source rho is ignored once a reclaimed bit is set", () => {
  for (const mid of [0b100, 0b010, 0b001, 0b110, 0b011]) {
    expect(foldRho(mid, 40, 3)).toBe(foldRho(mid, 1, 3));
  }
});

test("all-zero reclaimed bits push rho along by their width", () => {
  expect(foldRho(0b000, 5, 3)).toBe(8);
  expect(foldRho(0b000, 1, 1)).toBe(2);
  expect(foldRho(0b0000, 60, 4)).toBe(64);
});

test("index bits above the reclaimed window are ignored", () => {
  expect(foldRho(0b1111_000, 5, 3)).toBe(8);
  expect(foldRho(0b1010_010, 5, 3)).toBe(2);
});
