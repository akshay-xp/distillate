import { expect, test } from "vitest";

import { measureAllocation } from "../../bench/harness.js";
import { BinaryFuse8 } from "../../src/fuse/fuse.js";

// Alone in its file and in the single-worker project for the same reasons as
// tests/hll/allocation.test.ts.
//
// What this caught before it passed: has() wrote hash words past 2^30 to the
// module-level RLO/RHI and passed them as arguments to fmix64 and
// positionsInto, boxing a HeapNumber each time (about 56 bytes/op).
//
// Node 24 only. Node 22 still allocates 16 bytes/op with the same code:
// whether its TurboFan inlines the mix into has() varies run to run, and an
// uninlined call boxes the hash words again.
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

const keys: string[] = [];
for (let i = 0; i < 8192; i++) keys.push(`alloc:${String(i)}`);

test.skipIf(NODE_MAJOR < 24)(
  "has allocates nothing in steady state",
  async () => {
    const filter = BinaryFuse8.from(keys.slice(0, 4096));
    let at = 0;
    let hits = 0;
    const { collections } = await measureAllocation(() => {
      at = (at + 1) & 8191;
      if (filter.has(keys[at] ?? "")) hits++;
    }, 600_000);
    expect(hits).toBeGreaterThan(0);
    expect(collections).toBe(0);
  },
);
