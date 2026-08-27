import { expect, test } from "vitest";

import { measureBytesPerOp } from "../../bench/harness.js";
import { HyperLogLog } from "../../src/hll/hll.js";

// Lives alone in its file on purpose. measureBytesPerOp reads process-wide
// heap, so a neighbouring test that retains a few thousand keys shows up as
// bytes charged to the loop under measurement; vitest gives each file its own
// worker, which is the only reliable way to keep the heap quiet enough to
// measure. Sharing a file with the accuracy tests reported 40 bytes/op for a
// loop that allocates nothing.
//
// Skipped under coverage, which is a measurement problem rather than a licence
// to ignore a failure. The instrumented build allocates about one small object
// per add() call: the reading is a persistent 40.006 bytes/op on any machine,
// and unlike a warm-up plateau it does not go away when the measurement is
// repeated. The claim is about the code that ships, so measuring it under an
// instrument that changes allocation measures the instrument. `test (node 22)`
// and `test (node 24)` both run this for real in CI.
//
// The same 40.006 once reached CI from an uninstrumented run, as a warm-up
// plateau flat enough to defeat the harness warm-up rule. That is the harness's
// problem, not this test's, and measureBytesPerOp now repeats the whole
// measurement and keeps the lowest.
test.skipIf(process.env.DISTILLATE_COVERAGE === "1")(
  "add allocates nothing in steady state",
  () => {
    // add() reuses one Hash128 struct and writes into preallocated registers,
    // so a steady-state call should allocate nothing. Keys are pre-generated
    // and cycled so the loop measures add() rather than string building. The
    // sparse buffer is allowed to allocate, so the sketch is driven dense
    // first, deliberately rather than as a side effect of the key count.
    const sketch = new HyperLogLog({ p: 14 });
    const keys: string[] = [];
    for (let i = 0; i < 4096; i++) keys.push(`alloc:${String(i)}`);
    for (const key of keys) sketch.add(key);

    let at = 0;
    const bytesPerOp = measureBytesPerOp(() => {
      at = (at + 1) & 4095;
      sketch.add(keys[at] ?? "");
    }, 50_000);

    expect(bytesPerOp).toBeLessThan(16);
  },
);
