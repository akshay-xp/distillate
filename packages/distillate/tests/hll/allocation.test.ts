import { expect, test } from "vitest";

import { countCollections } from "../../bench/harness.js";
import { HyperLogLog } from "../../src/hll/hll.js";

// Lives alone in its file on purpose. Garbage collections are per-isolate, and
// vitest gives each file its own worker, so a neighbouring test that churns a
// few thousand keys cannot collect inside the window measured here.
//
// It also needs `fileParallelism: false`, set in vitest.config.ts. Workers
// competing for CPU do not add noise to this measurement, they change what it
// measures: under load V8 declines to inline the hash path and add() then
// really does allocate. With files in parallel this failed 1 full-suite run in
// 30; without, 0 in 30.
//
// Runs everywhere, coverage included. The heap-delta instrument had to be
// skipped there because it read a steady 40.006 bytes/op under instrumentation;
// counting collections does not, because it warms the loop before the window
// opens and coverage only lengthens the warm-up rather than changing what the
// settled code allocates.
//
// On the 40.006 bytes/op this once failed CI with: that figure was never an
// artifact of instrumentation, though the note committed in 418c89c said so.
// It is one `TextEncoder.encodeInto` result object per key, allocated whenever
// V8 has not inlined the hash path far enough for escape analysis to remove
// it, and it stops the moment TurboFan does. Coverage made it look permanent
// only because the instrument's own machinery stays unoptimised there, so the
// measured closure never got inlined either. Counting collections sidesteps
// the whole question: the loop is warmed first, and what is counted after that
// is what the shipped code actually costs.
test("add allocates nothing in steady state", async () => {
  // add() reuses one Hash128 struct and writes into preallocated registers,
  // so a steady-state call should allocate nothing. The reuse is what keeps
  // a call free before TurboFan has run; after it has, escape analysis would
  // remove a fresh struct too, and replacing #scratch with an object literal
  // per call measures zero collections all the same. What this probe catches
  // is allocation that outlives escape analysis, which is the kind that
  // actually costs: an exact-length subarray view in encodeKey measures 12.
  //
  // Keys are pre-generated
  // and cycled so the loop measures add() rather than string building. The
  // sparse buffer is allowed to allocate, so the sketch is driven dense
  // first, deliberately rather than as a side effect of the key count.
  const sketch = new HyperLogLog({ p: 14 });
  const keys: string[] = [];
  for (let i = 0; i < 4096; i++) keys.push(`alloc:${String(i)}`);
  for (const key of keys) sketch.add(key);

  let at = 0;
  const collections = await countCollections(() => {
    at = (at + 1) & 4095;
    sketch.add(keys[at] ?? "");
  }, 600_000);

  expect(collections).toBe(0);
});
