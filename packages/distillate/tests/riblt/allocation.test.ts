import { expect, test } from "vitest";

import { countCollections } from "../../bench/harness.js";
import { pushSymbol, RibltDecoder } from "../../src/riblt/decoder.js";
import { nextSymbol, RibltEncoder } from "../../src/riblt/encoder.js";

// Alone in its file and in vitest's allocation project for the reasons
// tests/hll/allocation.test.ts gives. The first window is discarded, as
// tests/ddsketch/allocation.test.ts explains.
//
// A difference of 950k keys decodes only past about 1.3M symbols, which keeps
// both windows peeling, on both sides, rather than measuring the cheap tail
// after the decode.
//
// The received symbols double at powers of two, and the doubling at 2^18 into
// a 10 MB buffer triggered a major collection under coverage, where the heap
// runs larger: growth, amortised, not a steady-state cost. So the warm-up
// runs past 2^18 and both windows end before 2^19. A hand-off is heavy enough
// to optimise well inside 20k calls, so each window warms for that rather than
// the default 500k, which would carry it past 2^19.
test("handing coded symbols to a peeling decoder allocates nothing", async () => {
  const remote = Array.from({ length: 1_000_000 }, (_, i) => `a:${String(i)}`);
  const local = [
    ...remote.slice(0, 100_000),
    ...Array.from({ length: 50_000 }, (_, i) => `b:${String(i)}`),
  ];
  const encoder = RibltEncoder.from(remote);
  const decoder = RibltDecoder.from(local);
  const symbol = new Uint32Array(5);

  // Counted as an integer, so the probe charges nothing to a boxed sink.
  let decoded = 0;
  for (let i = 0; i < 270_000; i++) {
    nextSymbol(encoder, symbol);
    if (pushSymbol(decoder, symbol)) decoded++;
  }
  await countCollections(
    () => {
      nextSymbol(encoder, symbol);
      if (pushSymbol(decoder, symbol)) decoded++;
    },
    100_000,
    20_000,
  );
  const collections = await countCollections(
    () => {
      nextSymbol(encoder, symbol);
      if (pushSymbol(decoder, symbol)) decoded++;
    },
    100_000,
    20_000,
  );

  expect(collections).toBe(0);
  expect(decoded).toBe(0);
});
