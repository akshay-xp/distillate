import { expect, test } from "vitest";

import { hash128Key } from "../../src/core/hasher.js";
import { ParamError } from "../../src/core/params.js";
import { pushSymbol, RibltDecoder } from "../../src/riblt/decoder.js";
import { nextSymbol, RibltEncoder } from "../../src/riblt/encoder.js";

const keysOf = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

// Hands A's coded symbols to B's decoder until it decodes; returns how many
// it took. A cap far past the expected 1.35 to 2 per difference turns a decode
// that never finishes into a failure rather than a hang.
function reconcile(
  encoder: RibltEncoder,
  decoder: RibltDecoder<string>,
  d: number,
): number {
  const symbol = new Uint32Array(5);
  for (let sent = 1; sent <= 100 * d + 100; sent++) {
    nextSymbol(encoder, symbol);
    if (pushSymbol(decoder, symbol)) return sent;
  }
  throw new Error(`no decode within ${String(100 * d + 100)} symbols`);
}

const sorted = (values: bigint[]): bigint[] =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

test("hashOf is the key's 64-bit symbol under the seed", () => {
  const { w0, w1 } = hash128Key("alice", 3);

  expect(RibltDecoder.hashOf("alice", 3)).toBe(
    (BigInt(w1) << 32n) | BigInt(w0),
  );
  expect(RibltDecoder.hashOf("alice")).not.toBe(
    RibltDecoder.hashOf("alice", 3),
  );
});

test("two empty sets decode on the first symbol", () => {
  const decoder = new RibltDecoder<string>();

  expect(decoder.decoded).toBe(false);
  expect(reconcile(new RibltEncoder(), decoder, 0)).toBe(1);
  expect(decoder.decoded).toBe(true);
  expect(decoder.remote()).toEqual([]);
  expect(decoder.local()).toEqual([]);
});

test.each([1, 10, 1000])(
  "an empty decoder recovers all %i remote keys as hashes",
  (d) => {
    const remote = keysOf("a", d);
    const decoder = new RibltDecoder<string>();

    reconcile(RibltEncoder.from(remote), decoder, d);

    expect(sorted(decoder.remote())).toEqual(
      sorted(remote.map((k) => RibltDecoder.hashOf(k))),
    );
    expect(decoder.local()).toEqual([]);
  },
);

const sortedKeys = (keys: string[]): string[] => [...keys].sort();

test("identical sets decode on the first symbol with nothing to report", () => {
  const keys = keysOf("k", 10_000);
  const decoder = RibltDecoder.from(keys);

  expect(reconcile(RibltEncoder.from(keys), decoder, 0)).toBe(1);
  expect(decoder.local()).toEqual([]);
  expect(decoder.remote()).toEqual([]);
});

test("against an empty remote, local returns the decoder's own keys", () => {
  const keys = keysOf("b", 100);
  const decoder = RibltDecoder.from(keys);

  reconcile(new RibltEncoder(), decoder, 100);

  expect(sortedKeys(decoder.local())).toEqual(sortedKeys(keys));
  expect(decoder.remote()).toEqual([]);
});

test("disjoint sets recover both sides", () => {
  const a = keysOf("a", 500);
  const b = keysOf("b", 500);
  const decoder = RibltDecoder.from(b);

  reconcile(RibltEncoder.from(a), decoder, 1000);

  expect(sortedKeys(decoder.local())).toEqual(sortedKeys(b));
  expect(sorted(decoder.remote())).toEqual(
    sorted(a.map((k) => RibltDecoder.hashOf(k))),
  );
});

test.each([1, 10, 1000])(
  "a difference of %i over 10k shared keys decodes exactly",
  (d) => {
    const shared = keysOf("s", 10_000);
    const onlyA = keysOf("a", Math.ceil(d / 2));
    const onlyB = keysOf("b", Math.floor(d / 2));
    const decoder = new RibltDecoder<string>();
    for (const key of [...shared, ...onlyB]) decoder.add(key);

    reconcile(RibltEncoder.from([...onlyA, ...shared]), decoder, d);

    expect(sortedKeys(decoder.local())).toEqual(sortedKeys(onlyB));
    expect(sorted(decoder.remote())).toEqual(
      sorted(onlyA.map((k) => RibltDecoder.hashOf(k))),
    );
  },
);

test("adding a local key after the first symbol is rejected", () => {
  const decoder = new RibltDecoder<string>();
  pushSymbol(decoder, new Uint32Array(5));

  expect(() => {
    decoder.add("late");
  }).toThrow(ParamError);
});
