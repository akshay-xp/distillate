import { bench, run } from "mitata";

import { BinaryFuse16, BinaryFuse8 } from "../src/fuse/fuse.js";

import { benchLookup, envBanner, hitMissPools } from "./harness.js";

const { hit, miss } = hitMissPools(100_000);
const f8 = BinaryFuse8.from(hit);
const f16 = BinaryFuse16.from(hit);

console.log(envBanner());

bench("fuse8 build", () => BinaryFuse8.from(hit));
benchLookup("fuse8 has (hit)", f8, hit);
benchLookup("fuse8 has (miss)", f8, miss);

bench("fuse16 build", () => BinaryFuse16.from(hit));
benchLookup("fuse16 has (hit)", f16, hit);
benchLookup("fuse16 has (miss)", f16, miss);

await run();
