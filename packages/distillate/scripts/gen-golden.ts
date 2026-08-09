// Regenerates the committed golden serialization frames in tests/fixtures/golden.json.
// Each entry's `frame` is the base64 of its structure's toBytes output, rebuilt from the
// committed keys. Run only on an intentional format bump; CI never regenerates. `pnpm golden:gen`.
import { readFileSync, writeFileSync } from "node:fs";

import { BlockedBloomFilter } from "../src/blocked/index.js";
import { BloomFilter } from "../src/bloom/index.js";
import { toBase64 } from "../src/core/base64.js";
import { BinaryFuse8, BinaryFuse16 } from "../src/fuse/index.js";

interface Entry {
  name: string;
  kind: string;
  keys: string[];
  epsilon?: number;
  frame?: string;
}

const path = new URL("../tests/fixtures/golden.json", import.meta.url);
const golden = JSON.parse(readFileSync(path, "utf8")) as Entry[];

const bytes = (kind: string, keys: string[], epsilon: number): Uint8Array => {
  switch (kind) {
    case "bloom":
      return BloomFilter.from(keys, epsilon).toBytes();
    case "blocked":
      return BlockedBloomFilter.from(keys, epsilon).toBytes();
    case "fuse8":
      return BinaryFuse8.from(keys).toBytes();
    case "fuse16":
      return BinaryFuse16.from(keys).toBytes();
    case "v2": {
      // A well-formed v3 Bloom frame with the version byte forced to 2. readHeader
      // rejects on the version byte before the CRC check, so the stale CRC is moot.
      const v2 = BloomFilter.from(["a", "b", "c"], 0.01).toBytes();
      v2[4] = 2;
      return v2;
    }
    default:
      throw new Error(`unknown kind ${kind}`);
  }
};

for (const entry of golden) {
  entry.frame = toBase64(bytes(entry.kind, entry.keys, entry.epsilon ?? 0));
}

writeFileSync(path, JSON.stringify(golden, null, 2) + "\n");
console.log(`wrote ${String(golden.length)} frames to golden.json`);
