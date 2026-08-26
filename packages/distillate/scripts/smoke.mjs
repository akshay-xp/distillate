// Runtime smoke test: the built entries must import and work.
// Run under each target runtime in CI (node / bun / deno).
import { readFileSync } from "node:fs";

import { VERSION } from "../dist/index.js";
import {
  BlockedBloomFilter,
  blockedBitsPerKey,
} from "../dist/blocked/index.js";
import { BloomFilter, bloomSizing } from "../dist/bloom/index.js";
import {
  BinaryFuse8,
  BinaryFuse16,
  fuseBitsPerKey,
} from "../dist/fuse/index.js";
import { HyperLogLog, hllSizing } from "../dist/hll/index.js";

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

const sizing = bloomSizing(1000, 0.01);
if (sizing.m !== 9586 || sizing.k !== 7) {
  console.error(
    `smoke: bloomSizing(1000, 0.01) gave m=${sizing.m} k=${sizing.k}`,
  );
  process.exit(1);
}

if (blockedBitsPerKey(0.01) !== 11) {
  console.error(
    `smoke: blockedBitsPerKey(0.01) gave ${blockedBitsPerKey(0.01)}`,
  );
  process.exit(1);
}

const fuseKeys = Array.from({ length: 1000 }, (_, i) => `fuse:${i}`);
if (fuseBitsPerKey(1000, 8) !== BinaryFuse8.from(fuseKeys).bitsPerKey) {
  console.error("smoke: fuseBitsPerKey disagrees with the built filter");
  process.exit(1);
}

if (hllSizing(0.01).p !== 14) {
  console.error(`smoke: hllSizing(0.01) gave p=${hllSizing(0.01).p}`);
  process.exit(1);
}

// Under the promotion threshold, so the count is exact on every runtime and a
// loose bound would not hide a difference between them.
const hs = new HyperLogLog({ p: 14 });
for (let i = 0; i < 100; i++) hs.add(`hll:${i}`);
if (hs.count() !== 100) {
  console.error(`smoke: HyperLogLog counted ${hs.count()} of 100 keys`);
  process.exit(1);
}

const hsOther = new HyperLogLog({ p: 14 });
for (let i = 100; i < 200; i++) hsOther.add(`hll:${i}`);
const merged = hs.union(hsOther);
if (merged.count() !== 200) {
  console.error(`smoke: union counted ${merged.count()} of 200 keys`);
  process.exit(1);
}

if (!HyperLogLog.fromBytes(hs.toBytes()).equals(hs)) {
  console.error("smoke: HyperLogLog round-trip through toBytes lost state");
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

const rebuild = (kind, keys, epsilon, p) => {
  switch (kind) {
    case "bloom":
      return BloomFilter.from(keys, epsilon);
    case "blocked":
      return BlockedBloomFilter.from(keys, epsilon);
    case "fuse8":
      return BinaryFuse8.from(keys);
    case "fuse16":
      return BinaryFuse16.from(keys);
    case "hll": {
      const sketch = new HyperLogLog({ p });
      for (const key of keys) sketch.add(key);
      return sketch;
    }
    default:
      console.error(`smoke: unknown golden kind ${kind}`);
      process.exit(1);
  }
};

for (const { name, kind, keys, epsilon, p, frame } of golden) {
  if (kind === "v2") continue;
  const actual = rebuild(kind, keys, epsilon, p).toBytes();
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
  `smoke ok: VERSION = ${VERSION}, distillate/bloom + distillate/blocked + distillate/fuse + distillate/hll work (filters, sketch, sizing helpers), toBytes byte-identical to golden`,
);
