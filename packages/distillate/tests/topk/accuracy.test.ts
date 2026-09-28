import { expect, test } from "vitest";

import { TopK, type TopKEntry } from "../../src/topk/topk.js";
import {
  prefixedStream,
  truthOf,
  uniformStream,
  zipfStream,
} from "../helpers/frequency.js";

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function heldBy(sketch: TopK): Map<string, TopKEntry> {
  const held = new Map<string, TopKEntry>();
  for (const entry of sketch.top(sketch.capacity)) {
    held.set(decode(entry.key), entry);
  }
  return held;
}

// Checked as the stream runs rather than once at its end, since a purge that
// broke the guarantee could be papered over by the purges after it.
test("the one-sided guarantee holds at every point in a Zipf stream", () => {
  const sketch = new TopK({ capacity: 2048 });
  const truth = new Map<string, number>();
  const stream = zipfStream(1, 20_000, 200_000, 1.1);

  for (let i = 0; i < stream.length; i++) {
    const key = stream[i] ?? "";
    sketch.add(key);
    truth.set(key, (truth.get(key) ?? 0) + 1);
    if ((i + 1) % 20_000 !== 0) continue;

    const held = heldBy(sketch);
    for (const [k, actual] of truth) {
      const entry = held.get(k);
      if (entry === undefined) {
        // A key the map dropped reads 0, which is below its truth, but only a
        // key lighter than the error can have been dropped.
        expect(actual).toBeLessThanOrEqual(sketch.error());
        continue;
      }
      expect(sketch.count(k)).toBeGreaterThanOrEqual(actual);
      expect(entry.lowerBound).toBeLessThanOrEqual(actual);
    }
  }

  expect(sketch.error()).toBeGreaterThan(0);
  expect(sketch.total).toBe(200_000);
});

// The heavy-hitter half of the guarantee, and the reason Misra-Gries was chosen
// over HeavyKeeper: nothing heavier than the error can be silently dropped.
// 1600 distinct uniform keys is just past the 1536 load limit, so the map
// purges while some keys still outweigh the error; much wider and none would.
test.each<[string, () => string[]]>([
  ["Zipf", () => zipfStream(31, 20_000, 200_000, 1.1)],
  ["uniform", () => uniformStream(32, 1600, 200_000)],
  ["shared-prefix", () => prefixedStream(33, 1600, 200_000)],
])("every key heavier than the error is in top on a %s stream", (_, build) => {
  const stream = build();
  const sketch = new TopK({ capacity: 2048 });
  for (const key of stream) sketch.add(key);

  const held = heldBy(sketch);
  const heavy = [...truthOf(stream)].filter(
    ([, actual]) => actual > sketch.error(),
  );

  expect(sketch.error()).toBeGreaterThan(0);
  expect(heavy.length).toBeGreaterThan(0);
  for (const [key] of heavy) expect(held.has(key)).toBe(true);
});
