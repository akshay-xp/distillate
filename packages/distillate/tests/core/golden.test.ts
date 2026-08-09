import { describe, expect, test } from "vitest";

import { BlockedBloomFilter } from "../../src/blocked/index.js";
import { BloomFilter } from "../../src/bloom/index.js";
import { fromBase64 } from "../../src/core/base64.js";
import { bytesEqual, UnknownVersionError } from "../../src/core/serialize.js";
import { BinaryFuse8, BinaryFuse16 } from "../../src/fuse/index.js";
import goldenJson from "../fixtures/golden.json" with { type: "json" };

interface GoldenEntry {
  name: string;
  kind: string;
  keys: string[];
  epsilon?: number;
  frame?: string;
}

interface Filter {
  has(key: string): boolean;
  toBytes(): Uint8Array;
}

const golden = goldenJson as GoldenEntry[];

const build = (kind: string, keys: string[], epsilon: number): Filter => {
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
      throw new Error(`unknown kind ${kind}`);
  }
};

const parse = (kind: string, bytes: Uint8Array): Filter => {
  switch (kind) {
    case "bloom":
      return BloomFilter.fromBytes(bytes);
    case "blocked":
      return BlockedBloomFilter.fromBytes(bytes);
    case "fuse8":
      return BinaryFuse8.fromBytes(bytes);
    case "fuse16":
      return BinaryFuse16.fromBytes(bytes);
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
    const { kind, keys, epsilon } = entry;
    const bytes = frameBytes(entry);
    const parsed = parse(kind, bytes);
    for (const key of keys) expect(parsed.has(key)).toBe(true);
    expect(bytesEqual(parsed.toBytes(), bytes)).toBe(true);
    expect(bytesEqual(build(kind, keys, epsilon ?? 0).toBytes(), bytes)).toBe(
      true,
    );
  });
});

test("v2 frame is rejected on version", () => {
  const v2 = golden.find((g) => g.kind === "v2");
  if (!v2) throw new Error("v2 fixture missing from golden.json");
  const bytes = frameBytes(v2);
  expect(() => BloomFilter.fromBytes(bytes)).toThrow(UnknownVersionError);
});
