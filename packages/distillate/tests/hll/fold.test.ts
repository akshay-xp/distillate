import { expect, test } from "vitest";

import { foldDense, foldRho } from "../../src/hll/fold.js";
import { Registers } from "../../src/hll/registers.js";

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

// Registers 36, 37 and 38 all sit above destination register 9 at p=4, and
// differ only in the two bits the fold reclaims.
test("a register lands on the register holding its index prefix", () => {
  const src = new Registers(6);
  const dst = new Registers(4);
  src.set(36, 5);
  foldDense(src, 6, dst, 4);
  expect(dst.get(9)).toBe(7);
});

test("folding takes the largest folded value, not the largest raw one", () => {
  const src = new Registers(6);
  const dst = new Registers(4);
  src.set(36, 5); // low bits 00, so 2 + 5 = 7
  src.set(38, 63); // low bits 10, so 1 whatever the raw value
  foldDense(src, 6, dst, 4);
  expect(dst.get(9)).toBe(7);
});

test("an untouched register contributes nothing", () => {
  const src = new Registers(6);
  const dst = new Registers(4);
  foldDense(src, 6, dst, 4);
  expect([...dst.bytes].every((b) => b === 0)).toBe(true);

  src.set(36, 5);
  foldDense(src, 6, dst, 4);
  for (let i = 0; i < 16; i++) expect(dst.get(i)).toBe(i === 9 ? 7 : 0);
});

test("folding to the same precision keeps every register where it is", () => {
  const src = new Registers(6);
  const dst = new Registers(6);
  src.set(0, 3);
  src.set(36, 5);
  src.set(63, 61);
  foldDense(src, 6, dst, 6);
  expect(dst.bytes).toEqual(src.bytes);
});
