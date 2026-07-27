import { bench, run } from "mitata";

import { BinaryFuse8, BinaryFuse16 } from "../src/fuse/fuse.js";

const keys = Array.from({ length: 100000 }, (_, i) => `key:${String(i)}`);
const f8 = BinaryFuse8.from(keys);
const f16 = BinaryFuse16.from(keys);

bench("fuse8 build", () => BinaryFuse8.from(keys));
bench("fuse8 has (hit)", () => f8.has("key:1"));
bench("fuse8 has (miss)", () => f8.has("absent"));

bench("fuse16 build", () => BinaryFuse16.from(keys));
bench("fuse16 has (hit)", () => f16.has("key:1"));
bench("fuse16 has (miss)", () => f16.has("absent"));

await run();
