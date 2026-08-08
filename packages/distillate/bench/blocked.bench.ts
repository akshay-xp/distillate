import { bench, run } from "mitata";

import { BloomFilter } from "../src/bloom/bloom.js";
import { BlockedBloomFilter } from "../src/blocked/blocked.js";

import { benchLookup, cycle, envBanner, hitMissPools } from "./harness.js";

// 100k baseline: the filter fits in cache, so confining probes to one line buys
// nothing and blocked does not pull ahead here.
const { hit, miss } = hitMissPools(100_000);
const f = BlockedBloomFilter.create(100_000, 0.01);
for (const k of hit) f.add(k);

// 30M: the classic filter is ~36MB, past the M5 performance-core L2 (16MB), so
// lookups miss cache and blocked's single-cache-line probe wins. Fill by
// generating keys (no 30M-string array); query a 1M sample spread across the
// whole filter so probes actually touch cold memory (a tiny hot sample would
// stay cached and hide the effect).
const BIG = 30_000_000;
const SAMPLE = 1_000_000;
const STEP = Math.floor(BIG / SAMPLE);
const classicBig = BloomFilter.create(BIG, 0.01);
const blockedBig = BlockedBloomFilter.create(BIG, 0.01);
for (let i = 0; i < BIG; i++) {
  const k = `0:${String(i)}`;
  classicBig.add(k);
  blockedBig.add(k);
}
const bigHit = Array.from(
  { length: SAMPLE },
  (_, i) => `0:${String(i * STEP)}`,
);
const bigMiss = Array.from({ length: SAMPLE }, (_, i) => `1:${String(i)}`);

console.log(envBanner());

const nextAdd = cycle(hit);
bench("blocked add", () => {
  f.add(nextAdd());
});
benchLookup("blocked has (hit)", f, hit);
benchLookup("blocked has (miss)", f, miss);

benchLookup("classic has hit (30M)", classicBig, bigHit);
benchLookup("blocked has hit (30M)", blockedBig, bigHit);
benchLookup("classic has miss (30M)", classicBig, bigMiss);
benchLookup("blocked has miss (30M)", blockedBig, bigMiss);

await run();
