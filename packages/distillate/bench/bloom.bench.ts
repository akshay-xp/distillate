import { bench, run } from "mitata";

import { BloomFilter } from "../src/bloom/bloom.js";

import { benchLookup, cycle, envBanner, hitMissPools } from "./harness.js";

const { hit, miss } = hitMissPools(100_000);
const f = BloomFilter.create(100_000, 0.01);
for (const k of hit) f.add(k);

console.log(envBanner());

const nextAdd = cycle(hit);
bench("bloom add", () => {
  f.add(nextAdd());
});
benchLookup("bloom has (hit)", f, hit);
benchLookup("bloom has (miss)", f, miss);

await run();
