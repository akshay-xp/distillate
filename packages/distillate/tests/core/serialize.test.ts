import fc from "fast-check";
import { expect, test } from "vitest";

import {
  BadMagicError,
  bytesEqual,
  ChecksumError,
  FORMAT_VERSION,
  fromJSONEnvelope,
  readHeader,
  SerializationError,
  TruncatedError,
  UnknownVersionError,
  writeFrame,
  writeHeader,
} from "../../src/core/serialize.js";
import { BloomFilter } from "../../src/bloom/bloom.js";
import { BlockedBloomFilter } from "../../src/blocked/blocked.js";
import { HyperLogLog } from "../../src/hll/hll.js";
import { crc32 } from "../../src/core/crc32.js";

test("writeFrame allocates once and equals the writeHeader path", () => {
  const body = Uint8Array.of(9, 8, 7, 6, 5);
  const header = { version: FORMAT_VERSION, type: 5, flags: 3 };

  let captured: Uint8Array | undefined;
  const frame = writeFrame(header, 0, body.length, (b) => {
    captured = b;
    b.set(body);
  });

  expect(captured?.buffer).toBe(frame.buffer);
  expect(captured?.byteOffset).toBe(16);
  expect(captured?.length).toBe(body.length);
  expect(bytesEqual(frame, writeHeader(header, body))).toBe(true);
});

test("writeFrame refuses a params block that would unalign the payload", () => {
  const header = { version: FORMAT_VERSION, type: 5, flags: 0 };
  const noop = () => undefined;

  // 16 + paramsSize is where the payload starts, so paramsSize has to be a
  // multiple of 8. The 6 here is exactly what HyperLogLog used to declare.
  for (const paramsSize of [1, 2, 4, 6, 12, 14, 20]) {
    expect(() => writeFrame(header, paramsSize, 8, noop)).toThrow(RangeError);
  }

  for (const [paramsSize, payloadAt] of [
    [0, 16],
    [8, 24],
    [16, 32],
    [24, 40],
  ] as const) {
    const frame = writeFrame(header, paramsSize, 8, noop);
    expect(frame.length).toBe(16 + paramsSize + 8 + 4);
    expect((16 + paramsSize) % 8).toBe(0);
    expect(16 + paramsSize).toBe(payloadAt);
  }
});

test("params padding carrying data is rejected, not ignored", () => {
  // The padding v5 introduced is reserved space inside the body. Left
  // unchecked it repeats the header's defect: a later release could put a
  // field there and this one would read the frame under the old meaning.
  const cases = [
    ["bloom", new BloomFilter({ m: 1024, k: 7 }), 14, 16],
    ["blocked", BlockedBloomFilter.create(100, 0.01), 12, 16],
    ["hll", new HyperLogLog({ p: 14 }), 6, 8],
  ] as const;

  for (const [name, structure, fieldsEnd, paramsSize] of cases) {
    structure.add("alice");
    const clean = structure.toBytes();
    expect(Array.from(clean.subarray(16 + fieldsEnd, 16 + paramsSize))).toEqual(
      new Array(paramsSize - fieldsEnd).fill(0),
    );

    for (let at = fieldsEnd; at < paramsSize; at++) {
      const dirty = clean.slice();
      dirty[16 + at] = 0xff;
      const dv = new DataView(dirty.buffer);
      dv.setUint32(
        dirty.length - 4,
        crc32(dirty.subarray(0, dirty.length - 4)),
        true,
      );

      const parse = {
        bloom: () => BloomFilter.fromBytes(dirty),
        blocked: () => BlockedBloomFilter.fromBytes(dirty),
        hll: () => HyperLogLog.fromBytes(dirty),
      }[name];
      expect(parse, `${name} padding byte ${String(at)}`).toThrow(
        SerializationError,
      );
    }
  }
});

test("the header declares its body length and reserves the rest", () => {
  const body = Uint8Array.of(9, 8, 7, 6, 5);
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 3 },
    body,
  );

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  expect(view.getUint32(8, true)).toBe(body.length);
  expect(Array.from(frame.subarray(12, 16))).toEqual([0, 0, 0, 0]);
  expect(frame.length).toBe(16 + body.length + 4);
});

test("writeHeader frames magic, reserved byte, and round-trips fields", () => {
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 3 },
    Uint8Array.of(1, 2, 3),
  );
  expect(FORMAT_VERSION).toBe(5);
  expect(Array.from(frame.subarray(0, 4))).toEqual([0x44, 0x53, 0x54, 0x4c]);
  expect(frame[4]).toBe(5);
  expect(frame[7]).toBe(0);
  expect(readHeader(frame)).toEqual({
    version: FORMAT_VERSION,
    type: 5,
    flags: 3,
    body: Uint8Array.of(1, 2, 3),
  });
});

test("readHeader(writeHeader(...)) is identity (property)", () => {
  fc.assert(
    fc.property(
      fc.nat({ max: 255 }),
      fc.nat({ max: 255 }),
      fc.uint8Array({ maxLength: 64 }),
      (type, flags, body) => {
        const header = { version: FORMAT_VERSION, type, flags };
        expect(readHeader(writeHeader(header, body))).toEqual({
          ...header,
          body,
        });
      },
    ),
  );
});

const validFrame = (): Uint8Array =>
  writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 3 },
    Uint8Array.of(1, 2, 3),
  );

test("readHeader throws TruncatedError on too-short input", () => {
  expect(() => readHeader(new Uint8Array(5))).toThrow(TruncatedError);
});

test("readHeader throws BadMagicError on wrong magic", () => {
  const f = validFrame();
  f[0] ^= 0xff;
  expect(() => readHeader(f)).toThrow(BadMagicError);
});

test.each([1, -1])(
  "readHeader reports a body length off by %i as truncation, not corruption",
  (delta) => {
    const f = validFrame();
    const view = new DataView(f.buffer, f.byteOffset, f.byteLength);
    view.setUint32(8, view.getUint32(8, true) + delta, true);
    expect(() => readHeader(f)).toThrow(TruncatedError);
  },
);

test("readHeader throws UnknownVersionError on unsupported version", () => {
  const f = writeHeader({ version: 255, type: 0, flags: 0 }, new Uint8Array(0));
  expect(() => readHeader(f)).toThrow(UnknownVersionError);
});

test("a version 4 frame is rejected rather than misread", () => {
  // v5 moved every payload, so a v4 frame that still carries the DSTL magic
  // reaches the version check and must stop there rather than parse.
  const f = writeHeader({ version: 4, type: 1, flags: 0 }, new Uint8Array(32));
  expect(() => readHeader(f)).toThrow(UnknownVersionError);
});

test("readHeader throws ChecksumError on a corrupted body", () => {
  const f = validFrame();
  f[16] ^= 0xff;
  expect(() => readHeader(f)).toThrow(ChecksumError);
});

test("readHeader never throws a non-typed error (fuzz)", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 80 }), (bytes) => {
      try {
        readHeader(bytes);
      } catch (err) {
        expect(err).toBeInstanceOf(SerializationError);
      }
    }),
  );
});

test("readHeader handles every truncated prefix of a valid frame (fuzz)", () => {
  const f = validFrame();
  for (let len = 0; len <= f.length; len++) {
    try {
      readHeader(f.subarray(0, len));
    } catch (err) {
      expect(err).toBeInstanceOf(SerializationError);
    }
  }
});

test("fromJSONEnvelope surfaces invalid base64 data as SerializationError", () => {
  const env = {
    $: "distillate",
    v: FORMAT_VERSION,
    data: "!!!!not-base64!!!!",
  };
  expect(() => fromJSONEnvelope(env)).toThrow(SerializationError);
});

test("readHeader rejects a version-1 frame", () => {
  const frame = writeHeader(
    { version: 1, type: 1, flags: 0 },
    Uint8Array.of(1, 2, 3),
  );
  expect(() => readHeader(frame)).toThrow(UnknownVersionError);
});
