import { expect, test } from "vitest";

import { pushSymbol, RibltDecoder } from "../../src/riblt/decoder.js";
import { nextSymbol, RibltEncoder } from "../../src/riblt/encoder.js";

const SHARED = 1000;
const shared = Array.from({ length: SHARED }, (_, i) => `s:${String(i)}`);
const only = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}:${String(i)}`);

// One reconcile between sets that differ by d, split between the two sides.
// The shared keys cancel exactly when the decoder subtracts its own, so for a
// given seed and difference the symbol count is the same with 1000 of them as
// with 100k; more would only cost time, about tenfold under coverage. Seeded by the trial index, so the gate is deterministic. Returns
// how many coded symbols the decode took, after checking it recovered exactly
// the planted difference.
function symbolsToDecode(d: number, trial: number): number {
  const onlyA = only("a", Math.ceil(d / 2));
  const onlyB = only("b", Math.floor(d / 2));
  const encoder = RibltEncoder.from([...shared.slice(onlyA.length), ...onlyA], {
    seed: trial,
  });
  const decoder = RibltDecoder.from([...shared.slice(onlyB.length), ...onlyB], {
    seed: trial,
  });
  const symbol = new Uint32Array(5);
  let sent = 0;
  // A decode that stalls fails here rather than hanging the suite.
  do {
    if (sent > 10 * d + 1000)
      throw new Error(`no decode within ${String(sent)}`);
    nextSymbol(encoder, symbol);
    sent++;
  } while (!pushSymbol(decoder, symbol));

  expect([...decoder.local()].sort()).toEqual([...onlyB].sort());
  expect(decoder.remote().sort()).toEqual(
    onlyA.map((k) => RibltDecoder.hashOf(k, trial)).sort(),
  );
  return sent;
}

// Measured means: 1.81 at d 10, 1.47 at d 100, 1.36 at d 10000, against the
// paper's 1.35 for large d. Each bound sits about six standard errors above
// its mean: the trials are seeded, so that is room for a legitimate change,
// not for noise. Looser bounds missed a mapping whose gaps were doubled, which
// costs about 10%.
test.each([
  [10, 50, 2.2],
  [100, 50, 1.55],
  [10_000, 50, 1.38],
])(
  "a difference of %i over %i trials decodes from under %f symbols per key",
  (d, trials, bound) => {
    let total = 0;
    for (let trial = 0; trial < trials; trial++) {
      total += symbolsToDecode(d, trial);
    }

    expect(total / trials / d).toBeLessThan(bound);
  },
);
