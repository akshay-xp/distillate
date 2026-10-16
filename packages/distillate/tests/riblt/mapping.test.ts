import { expect, test } from "vitest";

import { R64 } from "../../src/core/hasher.js";
import { checksumOf, nextIndex } from "../../src/riblt/mapping.js";

function walk(state: Uint32Array, length: number): number[] {
  const out = [0];
  while (out.length < length) {
    out.push(nextIndex(state, 0, out[out.length - 1] ?? 0));
  }
  return out;
}

function sequence(lo: number, hi: number, length: number): number[] {
  checksumOf(lo, hi);
  return walk(new Uint32Array([R64[0] ?? 0, R64[1] ?? 0]), length);
}

test("the zero symbol still checksums to a non-zero pair", () => {
  checksumOf(0, 0);

  expect((R64[0] ?? 0) | (R64[1] ?? 0)).not.toBe(0);
});

test("a symbol maps to the same strictly increasing sequence every time", () => {
  const a = sequence(0xdeadbeef, 0x12345678, 20);

  expect(sequence(0xdeadbeef, 0x12345678, 20)).toEqual(a);
  expect(a[0]).toBe(0);
  for (let i = 1; i < a.length; i++) {
    expect(a[i]).toBeGreaterThan(a[i - 1] ?? 0);
  }
  expect(sequence(0xdeadbeef, 0x12345679, 20)).not.toEqual(a);
});

// A sequence seeded from 32 bits repeats across about n^2 / 2^33 pairs of
// symbols: some 116 at a million keys. Each such pair shares every coded
// symbol, so neither can ever be peeled and the decode never finishes.
test("checksums sharing a low lane still map to different sequences", () => {
  expect(walk(new Uint32Array([0xabcdef01, 1]), 20)).not.toEqual(
    walk(new Uint32Array([0xabcdef01, 2]), 20),
  );
});

// The density the paper's mapping promises, which is what lets a prefix of
// about 1.35 d coded symbols decode d differences. Rounding the gap up costs
// index 1 its share: it is reached when 1.5 * (1 / sqrt(u) - 1) <= 1, that is
// u >= 0.36, so 0.64 rather than 2/3. The Go reference rounds the same way.
test("index i is reached by about 1 / (1 + i/2) of all symbols", () => {
  const probes = [1, 2, 10, 100];
  const density = (i: number): number => (i === 1 ? 0.64 : 1 / (1 + i / 2));
  const hits = new Map<number, number>(probes.map((i) => [i, 0]));
  const symbols = 1_000_000;
  let x = 0x9e3779b9;
  const state = new Uint32Array(2);
  for (let s = 0; s < symbols; s++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    checksumOf(x >>> 0, s);
    state[0] = R64[0] ?? 0;
    state[1] = R64[1] ?? 0;
    for (let index = 0; index <= 100; index = nextIndex(state, 0, index)) {
      const seen = hits.get(index);
      if (seen !== undefined) hits.set(index, seen + 1);
    }
  }

  for (const i of probes) {
    const expected = density(i);
    const actual = (hits.get(i) ?? 0) / symbols;
    expect(
      Math.abs(actual - expected) / expected,
      `index ${String(i)}`,
    ).toBeLessThan(0.03);
  }
});
