import fc from "fast-check";
import { expect, test } from "vitest";

import { CuckooFilter } from "../../src/cuckoo/cuckoo.js";
import { sampleStrings } from "../helpers/fpr.js";

test("each delete removes one copy of a key added more than once", () => {
  const f = CuckooFilter.create(1000, 0.01);
  f.add("k");
  f.add("k");

  expect(f.delete("k")).toBe(true);
  expect(f.has("k")).toBe(true);
  expect(f.count).toBe(1);

  expect(f.delete("k")).toBe(true);
  expect(f.has("k")).toBe(false);
  expect(f.count).toBe(0);

  expect(f.delete("k")).toBe(false);
});

test("deleting a key with no matching fingerprint changes nothing", () => {
  const f = CuckooFilter.create(1000, 0.01);
  for (const k of sampleStrings(30, 500)) f.add(k);
  const absent = sampleStrings(31, 1000).find((k) => !f.has(k)) ?? "";
  const probes = sampleStrings(32, 10_000);
  const snapshot = probes.map((p) => f.has(p));

  expect(f.delete(absent)).toBe(false);
  expect(f.count).toBe(500);
  expect(probes.map((p) => f.has(p))).toEqual(snapshot);
});

// Deletes are only ever issued for keys the model holds, which is the rule
// the filter documents: deleting a key never added can remove another key's
// matching fingerprint, and no filter can tell the two apart. Copies are
// capped at 4 so one key cannot fill both its buckets and throw full.
test("interleaved adds and deletes never lose a key still held", () => {
  const pool = sampleStrings(35, 50);
  const ops = fc.array(
    fc.record({ del: fc.boolean(), key: fc.integer({ min: 0, max: 49 }) }),
    { maxLength: 300 },
  );
  fc.assert(
    fc.property(ops, (seq) => {
      const f = CuckooFilter.create(1000, 0.01);
      const held = new Array<number>(pool.length).fill(0);
      for (const { del, key } of seq) {
        const k = pool[key] ?? "";
        if (del && (held[key] ?? 0) > 0) {
          f.delete(k);
          held[key] = (held[key] ?? 0) - 1;
        } else if (!del && (held[key] ?? 0) < 4) {
          f.add(k);
          held[key] = (held[key] ?? 0) + 1;
        }
      }
      const total = held.reduce((a, b) => a + b, 0);
      return (
        f.count === total &&
        pool.every((k, i) => (held[i] ?? 0) === 0 || f.has(k))
      );
    }),
  );
});

test("a deleted slot takes a new key, so churn at n never fills up", () => {
  const f = CuckooFilter.create(1000, 0.01);
  const first = sampleStrings(33, 1000);
  const second = sampleStrings(34, 1000);
  for (const k of first) f.add(k);

  first.forEach((k, i) => {
    f.delete(k);
    f.add(second[i] ?? "");
  });

  expect(f.count).toBe(1000);
  expect(second.every((k) => f.has(k))).toBe(true);
});
