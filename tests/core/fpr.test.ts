import { expect, test } from "vitest";

import { BitSet } from "../../src/core/bitset.js";
import { probes } from "../../src/core/hasher.js";
import { type Membership, measureFpr, sampleStrings } from "../helpers/fpr.js";

const M = 1 << 14;
const K = 7;

function bloom(): Membership {
  const bits = new BitSet(M);
  return {
    add(key) {
      for (const i of probes(key, K, M)) bits.set(i);
    },
    has(key) {
      for (const i of probes(key, K, M)) if (!bits.get(i)) return false;
      return true;
    },
  };
}

function disjoint(present: readonly string[], absent: string[]): string[] {
  const seen = new Set(present);
  return absent.filter((k) => !seen.has(k));
}

test("sampleStrings is deterministic for a given seed", () => {
  expect(sampleStrings(1, 100)).toHaveLength(100);
  expect(sampleStrings(1, 100)).toEqual(sampleStrings(1, 100));
});

test("measureFpr is 0 for an empty filter", () => {
  const absent = sampleStrings(2, 1000);
  expect(measureFpr(bloom(), [], absent)).toBe(0);
});

test("measureFpr is deterministic across identical rebuilds", () => {
  const present = sampleStrings(3, 2000);
  const absent = disjoint(present, sampleStrings(4, 5000));
  expect(measureFpr(bloom(), present, absent)).toBe(
    measureFpr(bloom(), present, absent),
  );
});

test("measureFpr reports a plausible rate for a sized bloom", () => {
  const present = sampleStrings(3, 2000);
  const absent = disjoint(present, sampleStrings(4, 5000));
  const fpr = measureFpr(bloom(), present, absent);
  expect(fpr).toBeGreaterThan(0);
  expect(fpr).toBeLessThan(0.25);
});
