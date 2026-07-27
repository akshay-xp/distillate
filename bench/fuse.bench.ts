import { bench, run } from "mitata";

import { BinaryFuse8 } from "../src/fuse/fuse.js";

const keys = Array.from({ length: 100000 }, (_, i) => `key:${String(i)}`);
const f8 = BinaryFuse8.from(keys);

bench("fuse8 build", () => BinaryFuse8.from(keys));
bench("fuse8 has (hit)", () => f8.has("key:1"));
bench("fuse8 has (miss)", () => f8.has("absent"));

await run();
