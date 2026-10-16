import { expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { FORMAT_VERSION, readHeader } from "../../src/core/serialize.js";
import { nextSymbol, RibltEncoder } from "../../src/riblt/encoder.js";

const keys = Array.from({ length: 50 }, (_, i) => `key:${String(i)}`);

interface Parsed {
  type: number;
  version: number;
  flags: number;
  bodyLength: number;
  seed: number;
  start: number;
  count: number;
  padding: number;
  symbols: number[][];
}

// Reads the layout the plan fixes, independently of the code under test:
// params (seed, start, count, 4 zero bytes), then sums, checksums and counts
// as separate aligned columns.
function parse(frame: Uint8Array): Parsed {
  const { type, version, flags, body } = readHeader(frame);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const count = view.getUint32(8, true);
  const symbols: number[][] = [];
  for (let i = 0; i < count; i++) {
    symbols.push([
      view.getUint32(16 + 8 * i, true),
      view.getUint32(16 + 8 * i + 4, true),
      view.getUint32(16 + 8 * count + 8 * i, true),
      view.getUint32(16 + 8 * count + 8 * i + 4, true),
      view.getUint32(16 + 16 * count + 4 * i, true),
    ]);
  }
  return {
    type,
    version,
    flags,
    bodyLength: body.length,
    seed: view.getUint32(0, true),
    start: view.getUint32(4, true),
    count,
    padding: view.getUint32(12, true),
    symbols,
  };
}

function symbols(encoder: RibltEncoder, n: number): number[][] {
  const out: number[][] = [];
  const symbol = new Uint32Array(5);
  for (let i = 0; i < n; i++) {
    nextSymbol(encoder, symbol);
    out.push([...symbol]);
  }
  return out;
}

test("take writes the next symbols as a type-12 frame", () => {
  const encoder = RibltEncoder.from(keys, { seed: 7 });
  const twin = RibltEncoder.from(keys, { seed: 7 });

  const first = parse(encoder.take(4));

  expect(first).toEqual({
    type: 12,
    version: FORMAT_VERSION,
    flags: 0,
    bodyLength: 16 + 4 * 20,
    seed: 7,
    start: 0,
    count: 4,
    padding: 0,
    symbols: symbols(twin, 4),
  });
  const second = parse(encoder.take(3));
  expect(second.start).toBe(4);
  expect(second.symbols).toEqual(symbols(twin, 3));
});

test("take refuses a batch that is not a positive integer", () => {
  const encoder = RibltEncoder.from(keys);

  expect(() => encoder.take(0)).toThrow(ParamError);
  expect(() => encoder.take(1.5)).toThrow(ParamError);
});

test("stream yields the same frames as consecutive takes", () => {
  const stream = RibltEncoder.from(keys).stream(5);
  const twin = RibltEncoder.from(keys);

  for (let i = 0; i < 3; i++) {
    expect(stream.next().value).toEqual(twin.take(5));
  }
});

test("stream refuses a batch that is not a positive integer", () => {
  expect(() => RibltEncoder.from(keys).stream(0).next()).toThrow(ParamError);
});
