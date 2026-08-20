import { BlockedBloomFilter } from "distillate/blocked";
import { bloomSizing } from "distillate/bloom";
import { BinaryFuse8 } from "distillate/fuse";
import { expect, test } from "vitest";

import { Playground } from "../src/components/playground/engine.js";

const KEYS = 10_000;
const TARGET = 0.01;

/** The same keys the engine generates, so a filter built here is comparable. */
const SAME_KEYS = Array.from({ length: KEYS }, (_, i) => `key-${String(i)}`);

function built(keyCount: number = KEYS, target: number = TARGET) {
  const result = Playground.build(keyCount, target);
  if (!result.ok) throw new Error(`build refused: ${result.message}`);
  return result.playground;
}

test("all three structures are built from the same key set", () => {
  const report = built().report();

  expect(report.keyCount).toBe(KEYS);
  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    expect(report.structures[key].heldKeys).toBe(KEYS);
  }
});

test("every inserted key is found, in every structure", () => {
  const report = built().report();

  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    expect(report.structures[key].missing).toBe(0);
  }
});

test("reported space matches what the library allocated", () => {
  const { structures } = built().report();

  expect(structures.bloom.bitsPerKey).toBeCloseTo(
    bloomSizing(KEYS, TARGET).m / KEYS,
    10,
  );
  // Blocked and fuse round their allocation up in structure-specific ways, so
  // the honest reference is a filter built over the same keys, not a formula.
  expect(structures.blocked.bitsPerKey).toBe(
    BlockedBloomFilter.from(SAME_KEYS, TARGET).bitsPerKey,
  );
  expect(structures.fuse8.bitsPerKey).toBe(
    BinaryFuse8.from(SAME_KEYS).bitsPerKey,
  );

  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    const { bitsPerKey, totalBytes } = structures[key];
    expect(totalBytes).toBe(Math.ceil((bitsPerKey * KEYS) / 8));
  }
});

test("the miss set is 20,000 keys and the rate is measured against it", () => {
  const { probeCount, structures } = built().report();

  expect(probeCount).toBe(20_000);
  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    const { falsePositives, measuredFpr } = structures[key];
    expect(measuredFpr).toBe(falsePositives / probeCount);
  }
});

test("both bloom variants land within a factor of two of the target", () => {
  const { structures } = built().report();

  for (const key of ["bloom", "blocked"] as const) {
    expect(structures[key].measuredFpr).toBeGreaterThanOrEqual(TARGET / 2);
    expect(structures[key].measuredFpr).toBeLessThanOrEqual(TARGET * 2);
  }
});

test("fuse holds its fingerprint-fixed rate whatever the target is", () => {
  for (const target of [TARGET, 0.2, 1e-4]) {
    const { measuredFpr } = built(KEYS, target).report().structures.fuse8;

    expect(measuredFpr).toBeGreaterThanOrEqual(0.002);
    expect(measuredFpr).toBeLessThanOrEqual(0.006);
  }
});
