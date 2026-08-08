import { bench, do_not_optimize, run } from "mitata";

import { hash128, probes } from "../src/core/hasher.js";
import { crc32 } from "../src/core/crc32.js";

import { cycle, envBanner, hitMissPools } from "./harness.js";

const encoder = new TextEncoder();
const keys = hitMissPools(1000).hit.map((k) => encoder.encode(k));
const nextKey = cycle(keys);

console.log(envBanner());

bench("hash128 (key)", () => {
  do_not_optimize(hash128(nextKey()));
});
bench("probes (k=7, m=2^16)", () => {
  do_not_optimize(probes(nextKey(), 7, 1 << 16));
});

const crcBuf = new Uint8Array(11 << 20);
for (let i = 0; i < crcBuf.length; i++) crcBuf[i] = (i * 37 + 11) & 0xff;
bench("crc32 (11 MB)", () => {
  do_not_optimize(crc32(crcBuf));
});

await run();
