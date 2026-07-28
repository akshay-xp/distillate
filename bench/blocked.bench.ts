import { bench, run } from "mitata";

import { BlockedBloomFilter } from "../src/blocked/blocked.js";

import { benchLookup, cycle, envBanner, hitMissPools } from "./harness.js";

const { hit, miss } = hitMissPools(100_000);
const f = BlockedBloomFilter.create(100_000, 0.01);
for (const k of hit) f.add(k);

console.log(envBanner());

const nextAdd = cycle(hit);
bench("blocked add", () => {
  f.add(nextAdd());
});
benchLookup("blocked has (hit)", f, hit);
benchLookup("blocked has (miss)", f, miss);

await run();
