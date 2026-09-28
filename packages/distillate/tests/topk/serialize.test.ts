import fc from "fast-check";
import { expect, test } from "vitest";

import { crc32 } from "../../src/core/crc32.js";
import {
  FORMAT_VERSION,
  HASH_MURMUR128,
  SerializationError,
  UnknownHashVariantError,
  writeHeader,
} from "../../src/core/serialize.js";
import { TopK, TopKOverflowError } from "../../src/topk/topk.js";
import { zipfStream } from "../helpers/frequency.js";

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

test("the frame follows the documented layout", () => {
  const s = new TopK({ capacity: 16, seed: 5 });
  s.add("b", 3);
  s.add("a", 3);
  s.add("c", 7);
  const frame = s.toBytes();
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  expect(frame[5]).toBe(9);
  expect(frame[6]).toBe(HASH_MURMUR128);
  expect(view.getUint32(8, true)).toBe(32 + 8 * 3 + 3);

  expect(view.getUint32(16, true)).toBe(16);
  expect(view.getUint32(20, true)).toBe(3);
  expect(view.getFloat64(24, true)).toBe(0);
  expect(view.getFloat64(32, true)).toBe(13);
  expect(view.getUint32(40, true)).toBe(5);
  expect([...frame.subarray(44, 48)]).toEqual([0, 0, 0, 0]);

  // Counts then lengths, both on 4-byte boundaries so a foreign reader can map
  // them as u32 slices; then the keys, heaviest first, ties by key bytes.
  expect(48 % 4).toBe(0);
  expect(60 % 4).toBe(0);
  const u32s = (at: number): number[] =>
    [0, 1, 2].map((i) => view.getUint32(at + 4 * i, true));
  expect(u32s(48)).toEqual([7, 3, 3]);
  expect(u32s(60)).toEqual([1, 1, 1]);
  expect(decode(frame.subarray(72, 75))).toBe("cab");
});

// Without a canonical order the map's insertion history would leak into the
// bytes, and equals could not be byte equality.
test("the same entries produce the same bytes whatever order they arrived in", () => {
  const entries: [string, number][] = [
    ["a", 3],
    ["b", 3],
    ["c", 1],
    ["d", 7],
  ];
  const forward = new TopK({ capacity: 64 });
  for (const [k, n] of entries) forward.add(k, n);
  const reversed = new TopK({ capacity: 64 });
  for (const [k, n] of [...entries].reverse()) reversed.add(k, n);
  const interleaved = new TopK({ capacity: 64 });
  for (let round = 0; round < 7; round++) {
    for (const [k, n] of entries) if (round < n) interleaved.add(k);
  }

  expect(reversed.toBytes()).toEqual(forward.toBytes());
  expect(interleaved.toBytes()).toEqual(forward.toBytes());
});

const filled = (): TopK => {
  const s = new TopK({ capacity: 256, seed: 3 });
  for (let i = 0; i < 100; i++) s.add(`key:${String(i)}`, (i % 7) + 1);
  return s;
};

const purged = (): TopK => {
  const s = new TopK({ capacity: 64 });
  for (const key of zipfStream(61, 2_000, 20_000, 1.1)) s.add(key);
  return s;
};

const withEmptyKey = (): TopK => {
  const s = new TopK({ capacity: 16 });
  s.add("", 3);
  s.add("a", 1);
  return s;
};

const examples: [string, () => TopK][] = [
  ["empty", () => TopK.create(0.01)],
  ["filled", filled],
  ["purged", purged],
  ["empty-key", withEmptyKey],
];

test.each(examples)("a %s sketch round-trips byte-identically", (_, make) => {
  const s = make();
  const restored = TopK.fromBytes(s.toBytes());

  expect(restored.capacity).toBe(s.capacity);
  expect(restored.seed).toBe(s.seed);
  expect(restored.total).toBe(s.total);
  expect(restored.error()).toBe(s.error());
  expect(restored.top(s.capacity)).toEqual(s.top(s.capacity));
  expect(restored.toBytes()).toEqual(s.toBytes());

  // A restored sketch must carry on exactly as the original would, which it
  // cannot if the live entry count was lost: the next purge would land late.
  for (let i = 0; i < 1000; i++) {
    const key = `x:${String(i % 300)}`;
    s.add(key);
    restored.add(key);
  }
  expect(restored.toBytes()).toEqual(s.toBytes());
});

test("the purged example really purged", () => {
  expect(purged().error()).toBeGreaterThan(0);
});

// A zero-length key is a legal key: add("") normalises to empty bytes, and the
// frame carries it as a length of 0.
test("a zero-length key round-trips", () => {
  const restored = TopK.fromBytes(withEmptyKey().toBytes());

  expect(restored.count("")).toBe(3);
  expect(restored.top(1)[0]?.key).toEqual(new Uint8Array(0));
});

test("every truncated prefix of a frame is rejected with a typed error", () => {
  const frame = filled().toBytes();
  for (let n = 0; n < frame.length; n++) {
    expect(() => TopK.fromBytes(frame.subarray(0, n))).toThrow(
      SerializationError,
    );
  }
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

interface Forged {
  capacity?: number;
  entries?: number;
  offset?: number;
  total?: number;
  seed?: number;
  pad?: number;
  counts?: number[];
  lengths?: number[];
  keys?: number[];
  extra?: number[];
}

/**
 * A type 9 frame assembled field by field, sealed with a valid CRC. Defaults
 * are an empty 16-slot sketch; `entries` defaults to the number of counts, so
 * a caller can make the two disagree.
 */
const forge = ({
  capacity = 16,
  counts = [],
  entries = counts.length,
  offset = 0,
  total = 0,
  seed = 0,
  pad = 0,
  lengths = [],
  keys = [],
  extra = [],
}: Forged): Uint8Array => {
  const table = 4 * (counts.length + lengths.length);
  const body = new Uint8Array(32 + table + keys.length + extra.length);
  const view = new DataView(body.buffer);
  view.setUint32(0, capacity, true);
  view.setUint32(4, entries, true);
  view.setFloat64(8, offset, true);
  view.setFloat64(16, total, true);
  view.setUint32(24, seed, true);
  body[28] = pad;
  [...counts, ...lengths].forEach((v, i) => {
    view.setUint32(32 + 4 * i, v, true);
  });
  body.set([...keys, ...extra], 32 + table);
  return writeHeader(
    { version: FORMAT_VERSION, type: 9, flags: HASH_MURMUR128 },
    body,
  );
};

type Mutation = (frame: Uint8Array) => void;

const lies: [string, Mutation, new (...args: never[]) => Error][] = [
  ["type 1", (f) => (f[5] = 1), SerializationError],
  ["hash variant 1", (f) => (f[6] = 1), UnknownHashVariantError],
  ...[44, 45, 46, 47].map(
    (at): [string, Mutation, typeof SerializationError] => [
      `params padding byte ${String(at - 16)} set`,
      (f) => (f[at] = 1),
      SerializationError,
    ],
  ),
];

test.each(lies)("fromBytes rejects %s", (_, mutate, expected) => {
  const frame = filled().toBytes();
  mutate(frame);

  expect(() => TopK.fromBytes(resealed(frame))).toThrow(expected);
});

// A capacity the constructor refuses must surface as the error family every
// other decode failure throws, not as a raw ParamError.
test.each([100, 2, 0])(
  "fromBytes rejects capacity %s as a topk: SerializationError",
  (capacity) => {
    const decode = (): TopK => TopK.fromBytes(forge({ capacity }));

    expect(decode).toThrow(SerializationError);
    expect(decode).toThrow(/^topk:/);
  },
);

test("fromBytes rejects more entries than the load limit allows", () => {
  const counts = Array.from({ length: 13 }, (_, i) => 13 - i);
  const frame = forge({
    capacity: 16,
    counts,
    lengths: counts.map(() => 1),
    keys: counts.map((_, i) => 97 + i),
  });

  expect(() => TopK.fromBytes(frame)).toThrow(SerializationError);
});

test.each<[string, Forged]>([
  [
    "entries past the table",
    { counts: [1], lengths: [1], keys: [97], entries: 2 },
  ],
  [
    "keys shorter than their lengths",
    { counts: [1], lengths: [5], keys: [97, 98, 99] },
  ],
  // The case a length check alone would miss: every read stays in bounds, but
  // bytes are left over that no entry accounts for.
  [
    "lengths summing below the bytes left",
    { counts: [1], lengths: [1], keys: [97, 98, 99] },
  ],
  ["a trailing byte", { counts: [1], lengths: [1], keys: [97], extra: [0] }],
  [
    "a length no body could hold",
    { counts: [1], lengths: [0xffffffff], keys: [97] },
  ],
])("fromBytes rejects %s", (_, fields) => {
  expect(() => TopK.fromBytes(forge(fields))).toThrow(SerializationError);
});

// Both are f64 on the wire because both can pass 2^32, but only a non-negative
// safe integer can have been reached by counting.
test.each(
  (["offset", "total"] as const).flatMap((field) =>
    [-1, 0.5, 2 ** 53, Number.NaN, Infinity].map(
      (value) => [field, value] as const,
    ),
  ),
)("fromBytes rejects %s %s", (field, value) => {
  expect(() => TopK.fromBytes(forge({ [field]: value }))).toThrow(
    SerializationError,
  );
});

test("fromBytes accepts an offset and total at the edge of the safe range", () => {
  const s = TopK.fromBytes(
    forge({ offset: 7, total: Number.MAX_SAFE_INTEGER }),
  );

  expect(s.error()).toBe(7);
  expect(s.total).toBe(Number.MAX_SAFE_INTEGER);
});

const A = 97;
const B = 98;

test.each<[string, Forged]>([
  // A stored 0 marks an empty slot, so the entry would vanish on decode.
  ["a stored count of 0", { counts: [0], lengths: [1], keys: [A] }],
  [
    "counts in ascending order",
    { counts: [3, 7], lengths: [1, 1], keys: [A, B] },
  ],
  [
    "a tie in descending key order",
    { counts: [3, 3], lengths: [1, 1], keys: [B, A] },
  ],
  [
    "a duplicate key on a tie",
    { counts: [3, 3], lengths: [1, 1], keys: [A, A] },
  ],
  // Correctly ordered by count, so only the placement check can catch it.
  [
    "a duplicate key in count order",
    { counts: [5, 3], lengths: [1, 1], keys: [A, A] },
  ],
])("fromBytes rejects %s", (_, fields) => {
  expect(() => TopK.fromBytes(forge(fields))).toThrow(SerializationError);
});

test("the empty key sorts first among a tie", () => {
  const s = TopK.fromBytes(
    forge({ counts: [3, 3], lengths: [0, 1], keys: [A] }),
  );

  expect(s.count("")).toBe(3);
  expect(s.count("a")).toBe(3);
});

// Past the safe range the total loses precision and fromBytes refuses it, so
// without the guard the writer could produce a frame its own reader rejects.
test("an add that would carry the total past the safe integer range is refused", () => {
  const s = TopK.fromBytes(forge({ total: Number.MAX_SAFE_INTEGER - 5 }));

  expect(() => {
    s.add("a", 6);
  }).toThrow(TopKOverflowError);
  expect(s.total).toBe(Number.MAX_SAFE_INTEGER - 5);
  expect(s.count("a")).toBe(0);

  s.add("a", 5);
  expect(TopK.fromBytes(s.toBytes()).total).toBe(Number.MAX_SAFE_INTEGER);
});

test("the JSON envelope round-trips", () => {
  const s = purged();
  const restored = TopK.fromJSON(JSON.parse(JSON.stringify(s)) as unknown);

  expect(restored.toBytes()).toEqual(s.toBytes());
});

test.each<[string, unknown]>([
  ["a non-object", 7],
  ["a wrong tag", { $: "other", v: FORMAT_VERSION, data: "" }],
  ["a wrong version", { $: "distillate", v: 1, data: "" }],
])("fromJSON rejects %s", (_, value) => {
  expect(() => TopK.fromJSON(value)).toThrow(SerializationError);
});

// Entries are generated whole and laid out consistently, then tampered with
// some of the time, so the generator reaches decodable frames and not only
// rejections. Small alphabets make canonical order, ties and duplicate keys
// all common: two key bytes, counts to 4, capacities that are and are not
// powers of two, and offsets and totals on both sides of legal.
const forged = fc
  .record({
    capacity: fc.constantFrom(0, 4, 16, 16, 100),
    offset: fc.constantFrom(0, 0, 3, -1, 0.5, 2 ** 53),
    total: fc.constantFrom(0, 0, 3, -1, 0.5, 2 ** 53),
    pad: fc.constantFrom(0, 0, 0, 1),
    items: fc.array(
      fc.record({
        count: fc.nat({ max: 4 }),
        key: fc.array(fc.constantFrom(A, B), { maxLength: 2 }),
      }),
      { maxLength: 4 },
    ),
    surplus: fc.constantFrom(0, 0, 0, 1),
    extra: fc.constantFrom([], [], [], [0]),
  })
  .map(({ items, surplus, ...rest }) =>
    forge({
      ...rest,
      entries: items.length + surplus,
      counts: items.map((e) => e.count),
      lengths: items.map((e) => e.key.length),
      keys: items.flatMap((e) => e.key),
    }),
  );

test("a forged frame decodes to itself or throws a typed error (fuzz)", () => {
  fc.assert(
    fc.property(forged, (frame) => {
      let restored: TopK;
      try {
        restored = TopK.fromBytes(frame);
      } catch (err) {
        expect(err).toBeInstanceOf(SerializationError);
        return;
      }
      // Only canonical frames load, so whatever loads writes back exactly.
      expect(restored.toBytes()).toEqual(frame);
    }),
    { numRuns: 500 },
  );
});

test("the forged generator reaches both a working sketch and each rejection", () => {
  const outcomes = new Set<string>();
  for (const frame of fc.sample(forged, { numRuns: 3000, seed: 42 })) {
    try {
      TopK.fromBytes(frame);
      outcomes.add("ok");
    } catch (err) {
      outcomes.add((err as Error).name);
    }
  }

  expect([...outcomes].sort()).toEqual([
    "SerializationError",
    "TruncatedError",
    "ok",
  ]);
});
