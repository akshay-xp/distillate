import { expect, test } from "vitest";

import { measureAllocation } from "../../bench/harness.js";
import { pushSymbol, RibltDecoder } from "../../src/riblt/decoder.js";
import { nextSymbol, RibltEncoder } from "../../src/riblt/encoder.js";

// Alone in its file and in vitest's allocation project for the reasons
// tests/hll/allocation.test.ts gives. The first window is discarded, as
// tests/ddsketch/allocation.test.ts explains.
//
// A difference of 106k keys decodes only past about 143k symbols, so the
// windows peel, on both sides, rather than measuring the cheap tail after the
// decode.
//
// The received symbols double at powers of two, and a doubling inside a window
// is growth, amortised, not a steady-state cost. So the warm-up runs past 2^16
// and both windows end before 2^17. The discarded window is short so that the
// measured one gets 45k calls of that range: 16 bytes per call then fills the
// young generation the allocation project pins at 1 MB, which 20k did not. A
// hand-off is heavy enough to optimise well inside 5k calls.
test("handing coded symbols to a peeling decoder allocates nothing", async () => {
  const remote = Array.from({ length: 105_000 }, (_, i) => `a:${String(i)}`);
  const local = Array.from({ length: 1000 }, (_, i) => `b:${String(i)}`);
  const encoder = RibltEncoder.from(remote);
  const decoder = RibltDecoder.from(local);
  const symbol = new Uint32Array(5);

  // Counted as an integer, so the probe charges nothing to a boxed sink.
  let decoded = 0;
  for (let i = 0; i < 66_000; i++) {
    nextSymbol(encoder, symbol);
    if (pushSymbol(decoder, symbol)) decoded++;
  }
  await measureAllocation(
    () => {
      nextSymbol(encoder, symbol);
      if (pushSymbol(decoder, symbol)) decoded++;
    },
    5000,
    5000,
  );
  const { collections } = await measureAllocation(
    () => {
      nextSymbol(encoder, symbol);
      if (pushSymbol(decoder, symbol)) decoded++;
    },
    45_000,
    5000,
  );

  expect(collections).toBe(0);
  expect(decoded).toBe(0);
});
