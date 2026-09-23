import { describe, expect, test } from "vitest";

import { BlockedBloomFilter } from "../../src/blocked/index.js";
import { BloomFilter } from "../../src/bloom/index.js";
import { fromBase64 } from "../../src/core/base64.js";
import { hash128Key, reduce } from "../../src/core/hasher.js";
import { bytesEqual, UnknownVersionError } from "../../src/core/serialize.js";
import { BinaryFuse8, BinaryFuse16 } from "../../src/fuse/index.js";
import { HyperLogLog } from "../../src/hll/hll.js";
import { CountMinSketch } from "../../src/countmin/countmin.js";
import { CuckooFilter } from "../../src/cuckoo/cuckoo.js";
import { ScalableBloomFilter } from "../../src/scalable/scalable.js";
import goldenJson from "../fixtures/golden.json" with { type: "json" };

interface GoldenEntry {
  name: string;
  kind: string;
  keys: string[];
  epsilon?: number;
  delta?: number;
  p?: number;
  n?: number;
  growth?: number;
  tightening?: number;
  seed?: number;
  deletes?: string[];
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
    case "scalable": {
      const { n = 1, growth, tightening, seed } = entry;
      const filter = ScalableBloomFilter.create(n, epsilon, {
        growth,
        tightening,
        seed,
      });
      for (const key of keys) filter.add(key);
      return filter;
    }
    case "cuckoo": {
      const { n = 1, seed, deletes = [] } = entry;
      const filter = CuckooFilter.create(n, epsilon, { seed });
      for (const key of keys) filter.add(key);
      for (const key of deletes) filter.delete(key);
      return filter;
    }
    case "countmin": {
      const { delta = 0.01, seed } = entry;
      const sketch = CountMinSketch.create(epsilon, delta, { seed });
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
    case "scalable":
      return ScalableBloomFilter.fromBytes(bytes);
    case "cuckoo":
      return CuckooFilter.fromBytes(bytes);
    case "countmin":
      return CountMinSketch.fromBytes(bytes);
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
    const { kind, keys, deletes = [] } = entry;
    const bytes = frameBytes(entry);
    const parsed = parse(kind, bytes);

    // Filters answer for their keys. A sketch is checked against a fresh build
    // instead, since neither answers membership: an HLL count is an estimate,
    // and the dense fixture sits at p=4 where sixteen registers hold ten keys,
    // so it reports 8 by design.
    if (parsed instanceof HyperLogLog) {
      expect(parsed.equals(build(entry) as HyperLogLog)).toBe(true);
    } else if (parsed instanceof CountMinSketch) {
      expect(parsed.equals(build(entry) as CountMinSketch)).toBe(true);
    } else {
      // A deleted key may still answer true (a false positive), so only the
      // keys still held are asserted.
      for (const key of keys) {
        if (!deletes.includes(key)) {
          expect((parsed as Filter).has(key)).toBe(true);
        }
      }
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

test("the scalable fixtures pin chains of at least three stages", () => {
  const chains = golden.filter((g) => g.kind === "scalable");
  expect(chains.length).toBeGreaterThan(0);
  for (const entry of chains) {
    const parsed = ScalableBloomFilter.fromBytes(frameBytes(entry));
    expect(parsed.stages, entry.name).toBeGreaterThanOrEqual(3);
  }
});

// A frame that only ever used first-choice slots would pass even with the
// eviction walk broken, so the pinned one must include adds that found both
// buckets full. The model below places each key without evicting, using the
// variant 0 mapping, and counts the adds it could not place.
test("the cuckoo fixture pins evictions and deletes", () => {
  const entry = golden.find((g) => g.name === "cuckoo");
  if (!entry) throw new Error("cuckoo fixture missing from golden.json");
  const { keys, deletes = [], seed = 0 } = entry;
  const f = CuckooFilter.fromBytes(frameBytes(entry));
  const { buckets, fingerprintBits: bits } = f;

  const load = new Array<number>(buckets).fill(0);
  let bothFull = 0;
  for (const key of keys) {
    const { w0, w1 } = hash128Key(key, seed);
    const fp = w1 >>> (32 - bits) || 1;
    const i1 = reduce(w0, buckets);
    const i2 =
      (((Math.imul(fp, 0x5bd1e995) >>> 0) % buckets) + buckets - i1) % buckets;
    if ((load[i1] ?? 0) < 4) load[i1] = (load[i1] ?? 0) + 1;
    else if ((load[i2] ?? 0) < 4) load[i2] = (load[i2] ?? 0) + 1;
    else bothFull++;
  }

  expect(bothFull).toBeGreaterThan(0);
  expect(deletes.length).toBeGreaterThan(0);
  expect(f.count).toBe(keys.length - deletes.length);
});
