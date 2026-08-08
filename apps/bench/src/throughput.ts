import { BlockedBloomFilter } from "distillate/blocked";
import { BinaryFuse16, BinaryFuse8 } from "distillate/fuse";
import { bench } from "mitata";

import { adapters, TARGET_FPR } from "./adapters.js";
import { benchLookup, cycle, hitMissPools } from "./harness.js";

export function registerThroughputBenches(n: number): void {
  const { hit, miss } = hitMissPools(n);

  for (const a of adapters) {
    const empty = a.create(n);
    const nextAdd = cycle(hit);
    bench(`${a.name} add`, () => {
      empty.add(nextAdd());
    });
    const built = a.build(hit);
    benchLookup(`${a.name} has (hit)`, built, hit);
    benchLookup(`${a.name} has (miss)`, built, miss);
  }

  const blocked = BlockedBloomFilter.create(n, TARGET_FPR);
  for (const key of hit) blocked.add(key);
  benchLookup("blocked has (hit)", blocked, hit);
  benchLookup("blocked has (miss)", blocked, miss);

  const fuse8 = BinaryFuse8.from(hit);
  benchLookup("fuse8 has (hit)", fuse8, hit);
  benchLookup("fuse8 has (miss)", fuse8, miss);

  const fuse16 = BinaryFuse16.from(hit);
  benchLookup("fuse16 has (hit)", fuse16, hit);
  benchLookup("fuse16 has (miss)", fuse16, miss);
}
