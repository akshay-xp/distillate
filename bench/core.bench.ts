import { bench, run } from "mitata";

import { hash128, probes } from "../src/core/hasher.js";

const data = new Uint8Array(64);
for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xff;

bench("hash128 (64B)", () => hash128(data));
bench("probes (k=7, m=2^16)", () => probes("benchmark-key", 7, 1 << 16));

await run();
