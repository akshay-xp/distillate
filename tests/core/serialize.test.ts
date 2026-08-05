import fc from "fast-check";
import { expect, test } from "vitest";

import {
  BadMagicError,
  ChecksumError,
  FORMAT_VERSION,
  readHeader,
  SerializationError,
  TruncatedError,
  UnknownVersionError,
  writeHeader,
} from "../../src/core/serialize.js";

test("writeHeader frames magic, reserved byte, and round-trips fields", () => {
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 3 },
    Uint8Array.of(1, 2, 3),
  );
  expect(Array.from(frame.subarray(0, 4))).toEqual([0x41, 0x4d, 0x51, 0x46]);
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

test("readHeader throws UnknownVersionError on unsupported version", () => {
  const f = writeHeader({ version: 255, type: 0, flags: 0 }, new Uint8Array(0));
  expect(() => readHeader(f)).toThrow(UnknownVersionError);
});

test("readHeader throws ChecksumError on a corrupted body", () => {
  const f = validFrame();
  f[8] ^= 0xff;
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

test("readHeader rejects a version-1 frame", () => {
  const frame = writeHeader(
    { version: 1, type: 1, flags: 0 },
    Uint8Array.of(1, 2, 3),
  );
  expect(() => readHeader(frame)).toThrow(UnknownVersionError);
});
