import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import { ParamError } from "../../src/core/params.js";
import {
  ChecksumError,
  FORMAT_VERSION,
  HASH_MURMUR128,
  readHeader,
  SerializationError,
  TruncatedError,
  UnknownHashVariantError,
  writeHeader,
} from "../../src/core/serialize.js";
import { RibltDecoder } from "../../src/riblt/decoder.js";
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

// Recomputes the trailer so a mutation reaches the check under test instead of
// stopping at ChecksumError.
const resealed = (frame: Uint8Array): Uint8Array => {
  new DataView(frame.buffer).setUint32(
    frame.length - 4,
    crc32(frame.subarray(0, frame.length - 4)),
    true,
  );
  return frame;
};

const BODY = 16;

type Mutation = (frame: Uint8Array, view: DataView) => void;

const lies: [string, Mutation, new (...args: never[]) => Error][] = [
  ["type 11", (f) => (f[5] = 11), SerializationError],
  ["hash variant 1", (f) => (f[6] = 1), UnknownHashVariantError],
  ["a params padding byte set", (f) => (f[BODY + 13] = 1), SerializationError],
  [
    "a count the body cannot hold",
    (_, v) => {
      v.setUint32(BODY + 8, 5, true);
    },
    TruncatedError,
  ],
];

test.each(lies)("push rejects %s", (_, mutate, expected) => {
  const frame = RibltEncoder.from(keys).take(4);
  mutate(frame, new DataView(frame.buffer));

  expect(() => new RibltDecoder().push(resealed(frame))).toThrow(expected);
});

test("push rejects a flipped byte and a cut frame", () => {
  const frame = RibltEncoder.from(keys).take(4);
  const flipped = frame.slice();
  flipped[BODY + 20] = (flipped[BODY + 20] ?? 0) ^ 0xff;

  expect(() => new RibltDecoder().push(flipped)).toThrow(ChecksumError);
  expect(() => new RibltDecoder().push(frame.subarray(0, -1))).toThrow(
    TruncatedError,
  );
});

test("push rejects a body too short for its params", () => {
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 12, flags: HASH_MURMUR128 },
    new Uint8Array(8),
  );

  expect(() => new RibltDecoder().push(frame)).toThrow(TruncatedError);
});
