// Runtime smoke test: the built entries must import and work.
// Run under each target runtime in CI (node / bun / deno).
import { VERSION } from "../dist/index.js";
import { BlockedBloomFilter } from "../dist/blocked/index.js";
import { BloomFilter } from "../dist/bloom/index.js";
import { BinaryFuse8 } from "../dist/fuse/index.js";

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

const bf = BlockedBloomFilter.create(100, 0.01);
bf.add("smoke");
if (!bf.has("smoke")) {
  console.error("smoke: BlockedBloomFilter.has failed for an added key");
  process.exit(1);
}

const ff = BinaryFuse8.from(["smoke", "a", "b"]);
if (!ff.has("smoke")) {
  console.error("smoke: BinaryFuse8.has failed for a built key");
  process.exit(1);
}

console.log(
  `smoke ok: VERSION = ${VERSION}, distillate/bloom + distillate/blocked + distillate/fuse work`,
);
