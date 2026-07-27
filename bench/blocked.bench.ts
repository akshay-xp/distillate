import { bench, run } from "mitata";

import { BlockedBloomFilter } from "../src/blocked/blocked.js";

const f = BlockedBloomFilter.create(100_000, 0.01);
const key = "user:benchmark:42";
f.add(key);

bench("blocked add", () => f.add(key));
bench("blocked has (hit)", () => f.has(key));

await run();
