import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { BlockedBloomFilter } from "../../src/blocked/index.js";
import { BloomFilter } from "../../src/bloom/index.js";
import { ParamError } from "../../src/core/params.js";
import {
  FORMAT_VERSION,
  SerializationError,
  writeHeader,
} from "../../src/core/serialize.js";
import { BinaryFuse8, BinaryFuse16 } from "../../src/fuse/index.js";

interface Filter {
  has(key: string): boolean;
}

const entries: [string, (bytes: Uint8Array) => Filter][] = [
  ["bloom", (b) => BloomFilter.fromBytes(b)],
  ["blocked", (b) => BlockedBloomFilter.fromBytes(b)],
  ["fuse8", (b) => BinaryFuse8.fromBytes(b)],
  ["fuse16", (b) => BinaryFuse16.fromBytes(b)],
];

// Feeding hostile bytes to fromBytes must never surface an untyped error, OOM,
// or hang: it either rejects with a typed SerializationError/ParamError or
// returns a filter that answers has() without throwing.
const expectRobust = (
  fn: (bytes: Uint8Array) => Filter,
  bytes: Uint8Array,
): void => {
  let filter: Filter;
  try {
    filter = fn(bytes);
  } catch (e) {
    if (e instanceof SerializationError || e instanceof ParamError) return;
    throw e;
  }
  expect(typeof filter.has("probe")).toBe("boolean");
};

describe.each(entries)(
  "fuzz %s fromBytes over arbitrary bytes",
  (_name, fn) => {
    test("throws a typed error or returns a usable filter", () => {
      fc.assert(
        fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
          expectRobust(fn, bytes);
        }),
      );
    });
  },
);

// Raw random bytes almost never pass the CRC, so wrap arbitrary type/flags/body
// in a valid frame to reach each structure's param decode: the finding-6 guard
// that a declared length can never drive an oversized allocation.
describe.each(entries)(
  "fuzz %s fromBytes over valid-framed bodies",
  (_name, fn) => {
    test("throws a typed error or returns a usable filter", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 255 }),
          fc.nat({ max: 255 }),
          fc.uint8Array({ maxLength: 2048 }),
          (type, flags, body) => {
            const frame = writeHeader(
              { version: FORMAT_VERSION, type, flags },
              body,
            );
            expectRobust(fn, frame);
          },
        ),
      );
    });
  },
);
