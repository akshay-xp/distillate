// Runtime smoke test: the built entries must import and work.
// Run under each target runtime in CI (node / bun / deno).
import { VERSION } from "../dist/index.js";
import { BloomFilter } from "../dist/bloom/index.js";

if (typeof VERSION !== "string") {
  console.error(
    `smoke: expected VERSION to be a string, got ${typeof VERSION}`,
  );
  process.exit(1);
}

const f = BloomFilter.create(100, 0.01);
f.add("smoke");
if (!f.has("smoke")) {
  console.error("smoke: BloomFilter.has failed for an added key");
  process.exit(1);
}

console.log(`smoke ok: VERSION = ${VERSION}, siftr/bloom works`);
