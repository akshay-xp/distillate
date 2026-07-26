import { bench, run } from "mitata";

import { BloomFilter } from "../src/bloom/bloom.js";

const f = BloomFilter.create(100_000, 0.01);
const key = "user:benchmark:42";
f.add(key);

bench("bloom add", () => f.add(key));
bench("bloom has (hit)", () => f.has(key));

await run();
