import { expect, test } from "vitest";

import { hash128Key, R64 } from "../../src/core/hasher.js";
import { ParamError } from "../../src/core/params.js";
import { nextSymbol, RibltEncoder } from "../../src/riblt/encoder.js";
import { checksumOf, nextIndex } from "../../src/riblt/mapping.js";

const keys = Array.from({ length: 500 }, (_, i) => `key:${String(i)}`);

// Coded symbols built the slow way: walk every key's index sequence and fold
// its symbol and checksum into each index it reaches.
function oracle(input: string[], seed: number, length: number): number[][] {
  const out = Array.from({ length }, () => [0, 0, 0, 0, 0]);
  for (const key of input) {
    const { w0, w1 } = hash128Key(key, seed);
    checksumOf(w0, w1);
    const c0 = R64[0] ?? 0;
    const c1 = R64[1] ?? 0;
    const state = new Uint32Array([c0, c1]);
    for (let i = 0; i < length; i = nextIndex(state, 0, i)) {
      const cell = out[i] ?? [];
      cell[0] = ((cell[0] ?? 0) ^ w0) >>> 0;
      cell[1] = ((cell[1] ?? 0) ^ w1) >>> 0;
      cell[2] = ((cell[2] ?? 0) ^ c0) >>> 0;
      cell[3] = ((cell[3] ?? 0) ^ c1) >>> 0;
      cell[4] = (cell[4] ?? 0) + 1;
    }
  }
  return out;
}

function produce(encoder: RibltEncoder, length: number): number[][] {
  const out: number[][] = [];
  const symbol = new Uint32Array(5);
  for (let i = 0; i < length; i++) {
    nextSymbol(encoder, symbol);
    out.push([...symbol]);
  }
  return out;
}

test("a non-uint32 seed is rejected", () => {
  expect(() => new RibltEncoder({ seed: -1 })).toThrow(ParamError);
  expect(() => new RibltEncoder({ seed: 2 ** 32 })).toThrow(ParamError);
  expect(() => new RibltEncoder({ seed: 1.5 })).toThrow(ParamError);
});

test("each coded symbol folds in exactly the keys mapped to its index", () => {
  const encoder = new RibltEncoder();
  for (const key of keys) encoder.add(key);

  const symbols = produce(encoder, 50);

  expect(symbols).toEqual(oracle(keys, 0, 50));
  expect(symbols[0]?.[4]).toBe(500);
});

test("from builds the same encoder as add in a loop, under its seed", () => {
  expect(produce(RibltEncoder.from(keys, { seed: 7 }), 50)).toEqual(
    oracle(keys, 7, 50),
  );
});

test("an encoder without keys yields empty symbols", () => {
  expect(produce(new RibltEncoder(), 3)).toEqual([
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
});

// A key added after symbol i was produced would be missing from symbols 0..i
// yet present in the rest, which the peer cannot decode.
test("adding after the first symbol is rejected", () => {
  const encoder = RibltEncoder.from(keys);
  nextSymbol(encoder, new Uint32Array(5));

  expect(() => {
    encoder.add("late");
  }).toThrow(ParamError);
});
