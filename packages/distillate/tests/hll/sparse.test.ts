import { expect, test } from "vitest";

import { Registers } from "../../src/hll/registers.js";
import {
  compact,
  encodeSparse,
  foldSparse,
  SPARSE_P,
  sparseIndex,
  sparseRho,
} from "../../src/hll/sparse.js";

test("an entry round-trips its index and rho", () => {
  for (const index of [0, 1, 2 ** SPARSE_P - 1]) {
    for (const rho of [1, 63]) {
      const entry = encodeSparse(index, rho);
      expect(sparseIndex(entry)).toBe(index);
      expect(sparseRho(entry)).toBe(rho);
      // Entries are sorted as signed int32s, so they must stay positive.
      expect(entry).toBeGreaterThan(0);
      expect(entry).toBeLessThanOrEqual(0x7fffffff);
    }
  }
});

test("compact keeps the largest rho seen for an index", () => {
  const buf = Int32Array.of(
    encodeSparse(5, 3),
    encodeSparse(5, 9),
    encodeSparse(5, 1),
  );
  expect(compact(buf, 3)).toBe(1);
  expect(sparseIndex(buf[0] ?? 0)).toBe(5);
  expect(sparseRho(buf[0] ?? 0)).toBe(9);
});

test("compact leaves distinct entries sorted by index", () => {
  const buf = Int32Array.of(
    encodeSparse(900, 2),
    encodeSparse(3, 7),
    encodeSparse(41, 1),
  );
  expect(compact(buf, 3)).toBe(3);
  expect([0, 1, 2].map((i) => sparseIndex(buf[i] ?? 0))).toEqual([3, 41, 900]);
  expect([0, 1, 2].map((i) => sparseRho(buf[i] ?? 0))).toEqual([7, 1, 2]);
});

test("compact of an empty buffer counts nothing", () => {
  expect(compact(new Int32Array(8), 0)).toBe(0);
});

// Entries are hand-built rather than hashed, so the assertions state what the
// fold must produce instead of restating how it computes it.
const SHIFT = SPARSE_P - 14;

test("an entry folds to the dense register its index prefixes", () => {
  const registers = new Registers(14);
  const index = 20_000_000;
  foldSparse(Int32Array.of(encodeSparse(index, 5)), 1, 14, registers, 14);
  expect(registers.get(9765)).toBe(5);
});

test("folding keeps the largest rho among indices sharing a register", () => {
  const registers = new Registers(14);
  // Same top 14 bits, so both fold onto register 9000. The larger rho is
  // written first, so overwriting rather than maximising would lose it.
  const buf = Int32Array.of(
    encodeSparse(9000 << SHIFT, 11),
    encodeSparse((9000 << SHIFT) | 1234, 4),
  );
  foldSparse(buf, 2, 14, registers, 14);
  expect(registers.get(9000)).toBe(11);
});

test("folding sends distinct prefixes to distinct registers", () => {
  const registers = new Registers(14);
  const buf = Int32Array.of(
    encodeSparse(3 << SHIFT, 6),
    encodeSparse(4 << SHIFT, 2),
  );
  foldSparse(buf, 2, 14, registers, 14);
  expect(registers.get(3)).toBe(6);
  expect(registers.get(4)).toBe(2);
});

test("folding nothing leaves every register empty", () => {
  const registers = new Registers(4);
  foldSparse(new Int32Array(8), 0, 4, registers, 4);
  for (let i = 0; i < 16; i++) expect(registers.get(i)).toBe(0);
});

// Entries hold the rho they were recorded against, so folding to a coarser
// precision has to recompute it from the four index bits being reclaimed.
test("entries fold to a coarser precision than they were recorded at", () => {
  const registers = new Registers(10);
  // Dense index 4096 at p=14; its low four bits are zero, so the recorded rho
  // carries, pushed along by the four reclaimed bits.
  foldSparse(
    Int32Array.of(encodeSparse(4096 << SHIFT, 5)),
    1,
    14,
    registers,
    10,
  );
  expect(registers.get(256)).toBe(9);
});

test("a reclaimed bit overrides the recorded rho when folding", () => {
  // Dense index 5000 at p=14; its low four bits are 0b1000, so rho is 1 no
  // matter what the entry recorded.
  for (const recorded of [1, 40, 63]) {
    const registers = new Registers(10);
    foldSparse(
      Int32Array.of(encodeSparse(5000 << SHIFT, recorded)),
      1,
      14,
      registers,
      10,
    );
    expect(registers.get(312)).toBe(1);
  }
});

test("compact reads only the used prefix", () => {
  const buf = new Int32Array(8);
  buf[0] = encodeSparse(2, 4);
  buf[1] = encodeSparse(2, 6);
  expect(compact(buf, 2)).toBe(1);
  expect(sparseRho(buf[0])).toBe(6);
});
