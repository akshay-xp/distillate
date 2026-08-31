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
import { HLL_MAX_P, HLL_MIN_P } from "../../src/core/sizing.js";
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

interface HllBody {
  p: number;
  encoding: number;
  payload: Uint8Array;
}

/** Bytes a dense payload occupies at precision `p`. */
const denseLength = (p: number): number => (2 ** p * 6) / 8;

// p straddles both bounds and stops at 20, which keeps the exact-dense branch
// under a megabyte. The payload length is drawn against the p that came with
// it: the size a dense body must be, a whole number of sparse entries, or
// neither. Drawing it independently is what leaves the length checks unreached.
const hllBody: fc.Arbitrary<HllBody> = fc
  .tuple(fc.integer({ min: 0, max: 20 }), fc.nat({ max: 3 }))
  .chain(([p, encoding]) =>
    fc
      .oneof(
        // Whole for every p the sketch accepts; rounded only so that the
        // sub-minimum ones still produce a length fc can generate.
        fc.constant(Math.ceil(denseLength(p))),
        fc.nat({ max: 16 }).map((n) => n * 4),
        fc.nat({ max: 64 }),
      )
      .chain((length) =>
        fc.uint8Array({ minLength: length, maxLength: length }),
      )
      .map((payload) => ({ p, encoding, payload })),
  );

const inRange = (p: number): boolean => p >= HLL_MIN_P && p <= HLL_MAX_P;

const SAMPLES = 400;

// Two percent of the sample, so a trap has to be a routine outcome rather than
// one fast-check happens to stumble on. The property below runs 100 times, and
// a shape produced by 0.3% of bodies is one it never actually exercises.
const MIN_HITS = SAMPLES * 0.02;

// The shared table cannot reach any of this: a random type byte lands on 5 in
// one run of 256, and over 100,000 runs it produced no body the sketch accepts
// at all. So the generator that does reach the params block has to be checked
// itself, decision by decision.
test("the hll generator produces every malformed body fromBytes guards against", () => {
  const samples = fc.sample(hllBody, SAMPLES);
  const hits = (predicate: (b: HllBody) => boolean): number =>
    samples.filter(predicate).length;

  expect(hits((b) => !inRange(b.p))).toBeGreaterThan(MIN_HITS);
  expect(hits((b) => b.encoding !== 0 && b.encoding !== 1)).toBeGreaterThan(
    MIN_HITS,
  );
  expect(
    hits((b) => b.encoding === 1 && inRange(b.p) && b.payload.length % 4 !== 0),
  ).toBeGreaterThan(MIN_HITS);
  expect(
    hits(
      (b) =>
        b.encoding === 0 &&
        inRange(b.p) &&
        b.payload.length !== denseLength(b.p),
    ),
  ).toBeGreaterThan(MIN_HITS);
});
