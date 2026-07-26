import { bench, run } from "mitata";

import { hash128, probes } from "../src/core/hasher.js";

const key = new Uint8Array(16);
for (let i = 0; i < key.length; i++) key[i] = (i * 37 + 11) & 0xff;

bench("hash128 (16B)", () => hash128(key));
bench("probes (k=7, m=2^16)", () => probes(key, 7, 1 << 16));

await run();
