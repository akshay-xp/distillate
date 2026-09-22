import fc from "fast-check";
import { expect, test } from "vitest";

import { hash128Key, reduce } from "../../src/core/hasher.js";
import {
  bytesEqual,
  FORMAT_VERSION,
  readHeader,
} from "../../src/core/serialize.js";
import { CuckooFilter } from "../../src/cuckoo/cuckoo.js";
import { sampleStrings } from "../helpers/fpr.js";

const filled = (
  n: number,
  epsilon: number,
  keys: string[],
  seed = 0,
): CuckooFilter => {
  const f = CuckooFilter.create(n, epsilon, { seed });
  for (const k of keys) f.add(k);
  return f;
};

const halfDeleted = (): CuckooFilter => {
  const keys = sampleStrings(42, 500);
  const f = filled(500, 0.01, keys);
  for (const k of keys.slice(0, 250)) f.delete(k);
  return f;
};

const examples: [string, () => CuckooFilter][] = [
  ["empty", () => CuckooFilter.create(10, 0.01)],
  ["seeded", () => filled(100, 0.01, sampleStrings(40, 100), 5)],
  ["filled to n then half deleted", halfDeleted],
  ["32-bit fingerprints", () => filled(100, 2e-9, sampleStrings(43, 100))],
];

test.each(examples)("a %s filter round-trips byte-identically", (_, make) => {
  const f = make();
  const bytes = f.toBytes();
  const restored = CuckooFilter.fromBytes(bytes);

  expect(bytesEqual(restored.toBytes(), bytes)).toBe(true);
  expect(restored.count).toBe(f.count);
  expect(restored.buckets).toBe(f.buckets);
  expect(restored.fingerprintBits).toBe(f.fingerprintBits);
  expect(restored.seed).toBe(f.seed);
  expect(restored.epsilon).toBe(f.epsilon);
  for (const k of sampleStrings(41, 2000)) {
    expect(restored.has(k)).toBe(f.has(k));
  }
});

// Reads the frame by the documented layout alone, not through fromBytes, and
// finds each key's fingerprint where variant 0 says it lives, so a layout
// that merely round-trips through its own reader cannot pass.
test("the frame follows the documented layout, with the slots 8-aligned", () => {
  const keys = sampleStrings(44, 100);
  const f = filled(100, 0.01, keys, 9);
  const { type, flags, body } = readHeader(f.toBytes());
  expect(type).toBe(7);
  expect(flags).toBe(0);

  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  expect(view.getUint32(0, true)).toBe(100);
  expect(view.getUint32(4, true)).toBe(9);
  expect(view.getFloat64(8, true)).toBe(0.01);
  const fBits = view.getUint32(16, true);
  const buckets = view.getUint32(20, true);
  expect(fBits).toBe(f.fingerprintBits);
  expect(buckets).toBe(f.buckets);
  expect(view.getUint32(24, true)).toBe(100);
  expect(view.getUint32(28, true)).toBe(0);

  const words = Math.ceil((4 * fBits * buckets) / 32);
  expect(body.length).toBe(32 + Math.ceil((words * 4) / 8) * 8);
  expect((16 + 32) % 8).toBe(0);

  const slot = (j: number): number => {
    let v = 0;
    for (let b = 0; b < fBits; b++) {
      const x = j * fBits + b;
      if (view.getUint32(32 + 4 * (x >>> 5), true) & (1 << (x & 31))) {
        v += 2 ** b;
      }
    }
    return v;
  };
  const inBucket = (i: number, fp: number): boolean =>
    [0, 1, 2, 3].some((s) => slot(i * 4 + s) === fp);
  for (const k of keys) {
    const { w0, w1 } = hash128Key(k, 9);
    const fp = w1 >>> (32 - fBits) || 1;
    const i1 = reduce(w0, buckets);
    const i2 =
      (((Math.imul(fp, 0x5bd1e995) >>> 0) % buckets) + buckets - i1) % buckets;
    expect(inBucket(i1, fp) || inBucket(i2, fp), k).toBe(true);
  }
});

test("the same keys in the same order give the same bytes", () => {
  const keys = sampleStrings(45, 500);

  expect(
    bytesEqual(
      filled(500, 0.01, keys, 3).toBytes(),
      filled(500, 0.01, keys, 3).toBytes(),
    ),
  ).toBe(true);
});

test("equals is exactly byte equality of the frame (property)", () => {
  // Small alphabet so independent builds sometimes match; the other kinds
  // each differ from the base in one way (a key, the seed, a delete) or not
  // at all (a restored copy).
  const keys = fc.array(fc.constantFrom("a", "b", "c", "d"), { maxLength: 40 });
  const seen = new Set<boolean>();
  fc.assert(
    fc.property(
      keys,
      keys,
      fc.constantFrom(
        "independent",
        "extra key",
        "seed",
        "deleted",
        "restored",
      ),
      (ka, kb, pair) => {
        const a = filled(50, 0.01, ka);
        let b: CuckooFilter;
        if (pair === "restored") b = CuckooFilter.fromBytes(a.toBytes());
        else if (pair === "seed") b = filled(50, 0.01, ka, 1);
        else if (pair === "extra key") b = filled(50, 0.01, [...ka, "e"]);
        else if (pair === "deleted") {
          b = filled(50, 0.01, ka);
          b.delete(ka[0] ?? "a");
        } else b = filled(50, 0.01, kb);
        const same = bytesEqual(a.toBytes(), b.toBytes());
        seen.add(same);
        expect(a.equals(b)).toBe(same);
      },
    ),
    { numRuns: 300 },
  );
  expect([...seen].sort()).toEqual([false, true]);
});

test("the JSON envelope round-trips", () => {
  const f = halfDeleted();
  const json = f.toJSON();
  expect(json.$).toBe("distillate");
  expect(json.v).toBe(FORMAT_VERSION);

  const restored = CuckooFilter.fromJSON(JSON.parse(JSON.stringify(json)));
  expect(bytesEqual(restored.toBytes(), f.toBytes())).toBe(true);
});
