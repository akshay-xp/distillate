import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { expect } from "vitest";

import { type TopK, type TopKEntry } from "../../src/topk/topk.js";

const decoder = new TextDecoder();

/** Every entry the sketch holds, keyed by its decoded key. */
export function heldBy(sketch: TopK): Map<string, TopKEntry> {
  const held = new Map<string, TopKEntry>();
  for (const entry of sketch.top(sketch.capacity)) {
    held.set(decoder.decode(entry.key), entry);
  }
  return held;
}

/**
 * Asserts the Top-K one-sided guarantee against `truth`: a held key's `count`
 * never falls below its true count and its `lowerBound` never rises above it,
 * and a key not held is no heavier than `error()`.
 *
 * Not "every key's `count` is at or above its truth": a purged key reads 0,
 * which is below its truth by design. What the structure rules out is losing
 * a key heavier than the error.
 */
export function expectOneSided(sketch: TopK, truth: Map<string, number>): void {
  const held = heldBy(sketch);
  for (const [key, actual] of truth) {
    const entry = held.get(key);
    if (entry === undefined) {
      expect(actual).toBeLessThanOrEqual(sketch.error());
      continue;
    }
    expect(sketch.count(key)).toBeGreaterThanOrEqual(actual);
    expect(entry.lowerBound).toBeLessThanOrEqual(actual);
  }
}

/** The largest capacity the sizing allows, where a full table is 201 MB. */
export const HUGE = 2 ** 24;

/** The most a sketch holding a handful of keys may allocate, whatever its capacity. */
export const SMALL = 1024 * 1024;

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/**
 * Bytes of `ArrayBuffer` memory `run` leaves allocated. Each test file runs in
 * its own process, so nothing outside the file moves this figure; collecting
 * first keeps an earlier test's garbage from being freed mid-measure and
 * cancelling out what `run` allocates.
 */
export function allocatedBy<T>(run: () => T): { value: T; bytes: number } {
  gc();
  const before = process.memoryUsage().arrayBuffers;
  const value = run();
  return { value, bytes: process.memoryUsage().arrayBuffers - before };
}
