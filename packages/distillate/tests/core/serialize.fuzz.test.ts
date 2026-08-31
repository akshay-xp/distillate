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
import { HyperLogLog } from "../../src/hll/hll.js";

interface Structure {
  parse: (bytes: Uint8Array) => unknown;
  answers: (value: unknown) => boolean;
}

// Pairs a parser with the call that proves what came back is usable. The call
// differs by family, a membership probe for the filters and a count for the
// sketch, so the type it is written against is erased here rather than being
// widened to something every structure happens to satisfy.
const structure = <T>(
  parse: (bytes: Uint8Array) => T,
  answers: (value: T) => boolean,
): Structure => ({ parse, answers: (value) => answers(value as T) });

const hll = structure(
  (b) => HyperLogLog.fromBytes(b),
  (sketch) => Number.isFinite(sketch.count()),
);

const answersHas = (filter: { has(key: string): boolean }): boolean =>
  typeof filter.has("probe") === "boolean";

const entries: [string, Structure][] = [
  ["bloom", structure((b) => BloomFilter.fromBytes(b), answersHas)],
  ["blocked", structure((b) => BlockedBloomFilter.fromBytes(b), answersHas)],
  ["fuse8", structure((b) => BinaryFuse8.fromBytes(b), answersHas)],
  ["fuse16", structure((b) => BinaryFuse16.fromBytes(b), answersHas)],
  ["hll", hll],
];

// Feeding hostile bytes to fromBytes must never surface an untyped error, OOM,
// or hang: it either rejects with a typed SerializationError/ParamError or
// returns a structure that answers without throwing.
const expectRobust = (s: Structure, bytes: Uint8Array): void => {
  let value: unknown;
  try {
    value = s.parse(bytes);
  } catch (e) {
    if (e instanceof SerializationError || e instanceof ParamError) return;
    throw e;
  }
  expect(s.answers(value)).toBe(true);
};

describe.each(entries)("fuzz %s fromBytes over arbitrary bytes", (_name, s) => {
  test("throws a typed error or returns a usable structure", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (bytes) => {
        expectRobust(s, bytes);
      }),
    );
  });
});

// Raw random bytes almost never pass the CRC, so wrap arbitrary type/flags/body
// in a valid frame to reach each structure's param decode: the finding-6 guard
// that a declared length can never drive an oversized allocation.
describe.each(entries)(
  "fuzz %s fromBytes over valid-framed bodies",
  (_name, s) => {
    test("throws a typed error or returns a usable structure", () => {
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
            expectRobust(s, frame);
          },
        ),
      );
    });
  },
);

// Frame geometry, per the published format: a 16-byte header, a 6-byte params
// block for type 5, then the payload, then the CRC.
const HEADER_SIZE = 16;
const PARAMS_SIZE = 6;
const CRC_SIZE = 4;

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
const forgedBody: fc.Arbitrary<HllBody> = fc
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

// Bodies the sketch actually accepts. Random bytes stopped being able to
// produce one once fromBytes started validating registers and entries: almost
// any 2 ** p random registers hold one above 65 - p, and half of all u32 words
// fail the 31-bit entry check. Without this branch the robustness property
// would only ever exercise rejection, which is what the `parses` floor below
// exists to catch.
const realBody: fc.Arbitrary<HllBody> = fc
  .tuple(fc.integer({ min: HLL_MIN_P, max: 12 }), fc.nat({ max: 400 }))
  .map(([p, n]) => {
    const sketch = new HyperLogLog({ p });
    for (let i = 0; i < n; i++) sketch.add(`fuzz:${String(i)}`);
    const frame = sketch.toBytes();
    const body = frame.subarray(HEADER_SIZE, frame.length - CRC_SIZE);
    return {
      p: body[0] ?? 0,
      encoding: body[1] ?? 0,
      payload: body.subarray(PARAMS_SIZE),
    };
  });

const hllBody: fc.Arbitrary<HllBody> = fc.oneof(forgedBody, realBody);

/** A well-formed type-5 frame carrying `body` as its params and payload. */
const hllFrame = (body: HllBody): Uint8Array =>
  writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 0 },
    Uint8Array.from([body.p, body.encoding, 0, 0, 0, 0, ...body.payload]),
  );

const parses = (body: HllBody): boolean => {
  try {
    HyperLogLog.fromBytes(hllFrame(body));
    return true;
  } catch {
    return false;
  }
};

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
  // Traps are sampled from the forged branch alone. A real body can never be
  // in any of them, so mixing the two would only dilute the rates and leave
  // the floor measuring the mix rather than the generator.
  const forged = fc.sample(forgedBody, SAMPLES);
  const hits = (predicate: (b: HllBody) => boolean): number =>
    forged.filter(predicate).length;

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

  // Parseability is a property of the generator the property below actually
  // uses, so it is sampled from that one.
  expect(fc.sample(hllBody, SAMPLES).filter(parses).length).toBeGreaterThan(
    MIN_HITS,
  );
});

describe("fuzz hll fromBytes over well-framed type-5 bodies", () => {
  test("throws a typed error or returns a usable structure", () => {
    fc.assert(
      fc.property(hllBody, (body) => {
        expectRobust(hll, hllFrame(body));
      }),
    );
  });
});

// The property above cannot see either params guard go missing: an out-of-range
// p just builds a mis-sized register array, and an unknown encoding falls
// through to the sparse branch, and both still answer count(). Each guard has
// to be asserted as a rejection instead.
test("a frame naming a precision outside the supported range is rejected", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ min: 0, max: HLL_MIN_P - 1 }),
        fc.integer({ min: HLL_MAX_P + 1, max: 255 }),
      ),
      fc.integer({ min: 0, max: 1 }),
      fc.uint8Array({ maxLength: 64 }),
      (p, encoding, payload) => {
        expect(() =>
          HyperLogLog.fromBytes(hllFrame({ p, encoding, payload })),
        ).toThrow(ParamError);
      },
    ),
  );
});

test("a frame naming an encoding the release does not have is rejected", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: HLL_MIN_P, max: HLL_MAX_P }),
      fc.integer({ min: 2, max: 255 }),
      fc.uint8Array({ maxLength: 64 }),
      (p, encoding, payload) => {
        expect(() =>
          HyperLogLog.fromBytes(hllFrame({ p, encoding, payload })),
        ).toThrow(SerializationError);
      },
    ),
  );
});
