import { describe, expect, test } from "vitest";

import { BlockedBloomFilter } from "../../src/blocked/index.js";
import { BloomFilter } from "../../src/bloom/index.js";
import { fromBase64 } from "../../src/core/base64.js";
import { bytesEqual, UnknownVersionError } from "../../src/core/serialize.js";
import { BinaryFuse8, BinaryFuse16 } from "../../src/fuse/index.js";
import { HyperLogLog } from "../../src/hll/hll.js";
import goldenJson from "../fixtures/golden.json" with { type: "json" };

interface GoldenEntry {
  name: string;
  kind: string;
  keys: string[];
  epsilon?: number;
  p?: number;
  frame?: string;
}

/** What every golden entry can do, whatever family it belongs to. */
interface Serializable {
  toBytes(): Uint8Array;
}

interface Filter extends Serializable {
  has(key: string): boolean;
}

const golden = goldenJson as GoldenEntry[];

const build = (entry: GoldenEntry): Serializable => {
  const { kind, keys, epsilon = 0, p = 14 } = entry;
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
      throw new Error(`unknown kind ${kind}`);
  }
};

const parse = (kind: string, bytes: Uint8Array): Serializable => {
  switch (kind) {
    case "bloom":
      return BloomFilter.fromBytes(bytes);
    case "blocked":
      return BlockedBloomFilter.fromBytes(bytes);
    case "fuse8":
      return BinaryFuse8.fromBytes(bytes);
    case "fuse16":
      return BinaryFuse16.fromBytes(bytes);
    case "hll":
      return HyperLogLog.fromBytes(bytes);
    default:
      throw new Error(`unknown kind ${kind}`);
  }
};

const frameBytes = (entry: GoldenEntry): Uint8Array => {
  const { frame } = entry;
  if (typeof frame !== "string") {
    throw new Error(`${entry.name} frame missing; run pnpm golden:gen`);
  }
  return fromBase64(frame);
};

const structures = golden.filter((g) => g.kind !== "v2");

describe.each(structures)("golden fixture $name", (entry) => {
  test("parses to the recipe's exact state", () => {
    const { kind, keys } = entry;
    const bytes = frameBytes(entry);
    const parsed = parse(kind, bytes);

    // Filters answer for their keys. A sketch is checked against a fresh build
    // instead: its count is an estimate, and the dense fixture sits at p=4
    // where sixteen registers hold ten keys, so it reports 8 by design.
    if (parsed instanceof HyperLogLog) {
      expect(parsed.equals(build(entry) as HyperLogLog)).toBe(true);
    } else {
      for (const key of keys) expect((parsed as Filter).has(key)).toBe(true);
    }

    expect(bytesEqual(parsed.toBytes(), bytes)).toBe(true);
    expect(bytesEqual(build(entry).toBytes(), bytes)).toBe(true);
  });
});

test("v2 frame is rejected on version", () => {
  const v2 = golden.find((g) => g.kind === "v2");
  if (!v2) throw new Error("v2 fixture missing from golden.json");
  const bytes = frameBytes(v2);
  expect(() => BloomFilter.fromBytes(bytes)).toThrow(UnknownVersionError);
});
