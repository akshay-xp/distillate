// Runtime smoke test: the built entries must import and work.
// Run under each target runtime in CI (node / bun / deno).
import { readFileSync } from "node:fs";

import { VERSION } from "../dist/index.js";
import { BlockedBloomFilter } from "../dist/blocked/index.js";
import { BloomFilter } from "../dist/bloom/index.js";
import { BinaryFuse8, BinaryFuse16 } from "../dist/fuse/index.js";

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

// Cross-runtime byte identity: every runtime must produce the exact committed
// golden frame for a fixed key set, not merely import and run.
const golden = JSON.parse(
  readFileSync(
    new URL("../tests/fixtures/golden.json", import.meta.url),
    "utf8",
  ),
);

const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const rebuild = (kind, keys, epsilon) => {
  switch (kind) {
    case "bloom":
      return BloomFilter.from(keys, epsilon);
    case "blocked":
      return BlockedBloomFilter.from(keys, epsilon);
    case "fuse8":
      return BinaryFuse8.from(keys);
    case "fuse16":
      return BinaryFuse16.from(keys);
    default:
      console.error(`smoke: unknown golden kind ${kind}`);
      process.exit(1);
  }
};

for (const { name, kind, keys, epsilon, frame } of golden) {
  if (kind === "v2") continue;
  const actual = rebuild(kind, keys, epsilon).toBytes();
  const expected = decode(frame);
  if (actual.length !== expected.length) {
    console.error(
      `smoke: ${name} toBytes length ${actual.length} differs from golden ${expected.length}`,
    );
    process.exit(1);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      console.error(`smoke: ${name} toBytes differs from golden at byte ${i}`);
      process.exit(1);
    }
  }
}

console.log(
  `smoke ok: VERSION = ${VERSION}, distillate/bloom + distillate/blocked + distillate/fuse work, toBytes byte-identical to golden`,
);
