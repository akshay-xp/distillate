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
