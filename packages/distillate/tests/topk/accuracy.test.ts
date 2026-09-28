import { expect, test } from "vitest";

import { TopK, type TopKEntry } from "../../src/topk/topk.js";
import { zipfStream } from "../helpers/frequency.js";

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
