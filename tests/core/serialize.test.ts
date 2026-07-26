import fc from "fast-check";
import { expect, test } from "vitest";

import {
  FORMAT_VERSION,
  readHeader,
  writeHeader,
} from "../../src/core/serialize.js";

test("writeHeader frames magic, reserved byte, and round-trips fields", () => {
  const frame = writeHeader(
    { version: 1, type: 5, flags: 3 },
    Uint8Array.of(1, 2, 3),
  );
  expect(Array.from(frame.subarray(0, 4))).toEqual([0x41, 0x4d, 0x51, 0x46]);
  expect(frame[7]).toBe(0);
  expect(readHeader(frame)).toEqual({
    version: 1,
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
