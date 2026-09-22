import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { CuckooFilter, type CuckooParams } from "../../src/cuckoo/cuckoo.js";

test("a new filter is empty and carries its sizing geometry", () => {
  const f = CuckooFilter.create(1000, 0.01);

  expect(f.count).toBe(0);
  expect(f.buckets).toBe(296);
  expect(f.capacity).toBe(1184);
  expect(f.fingerprintBits).toBe(10);
  expect(f.m).toBe(11840);
  expect(f.bitsPerKey).toBe(11.84);
  expect(f.seed).toBe(0);
  expect(f.epsilon).toBe(0.01);
});

test("a seed passed to the constructor or create is kept", () => {
  for (const f of [
    new CuckooFilter({ n: 10, epsilon: 0.01, seed: 7 }),
    CuckooFilter.create(10, 0.01, { seed: 7 }),
  ]) {
    expect(f.seed).toBe(7);
  }
});

test.each<[string, Partial<CuckooParams>]>([
  ["n 0", { n: 0 }],
  ["n 1.5", { n: 1.5 }],
  ["n 2^32", { n: 2 ** 32 }],
  ["epsilon 0", { epsilon: 0 }],
  ["epsilon 1", { epsilon: 1 }],
  ["epsilon NaN", { epsilon: Number.NaN }],
  ["epsilon 1e-9", { epsilon: 1e-9 }],
  ["seed -1", { seed: -1 }],
  ["seed 2^32", { seed: 2 ** 32 }],
])("%s is rejected with ParamError", (_, bad) => {
  expect(() => new CuckooFilter({ n: 10, epsilon: 0.01, ...bad })).toThrow(
    ParamError,
  );
});
