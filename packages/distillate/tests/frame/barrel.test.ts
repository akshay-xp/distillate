import { expect, test } from "vitest";

import * as bloom from "../../src/bloom/index.js";
import * as frame from "../../src/frame/index.js";

// UnknownHashVariantError is left out on purpose: only a structure's own
// fromBytes can tell whether it reproduces a hash variant.
test("the barrel exports the reader and the errors a frame read throws", () => {
  expect(Object.keys(frame).sort()).toEqual([
    "BadMagicError",
    "ChecksumError",
    "ReservedBitsError",
    "SerializationError",
    "TruncatedError",
    "UnknownVersionError",
    "readFrameAt",
  ]);
});

test("one catch matches a decode failure from any subpath", () => {
  expect(frame.SerializationError).toBe(bloom.SerializationError);
});

test("the barrel is wired to the real reader", () => {
  const bytes = new bloom.BloomFilter({ m: 64, k: 3 }).toBytes();
  expect(frame.readFrameAt(bytes, 0).type).toBe(1);
});
