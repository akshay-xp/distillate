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
import { readFrameAt } from "../dist/frame/index.js";
import { HyperLogLog, hllSizing } from "../dist/hll/index.js";
import { ScalableBloomFilter } from "../dist/scalable/index.js";
import { CuckooFilter } from "../dist/cuckoo/index.js";
import { CountMinSketch, countMinSizing } from "../dist/countmin/index.js";
import { TopK, topKSizing } from "../dist/topk/index.js";
import {
  collapsingLowestStore,
  DDSketch,
  logMapping,
} from "../dist/ddsketch/index.js";
import { fromProtobuf, toProtobuf } from "../dist/ddsketch/protobuf/index.js";
import { MinHash, MinHashLSH, minHashSizing } from "../dist/minhash/index.js";
import { RibltDecoder, RibltEncoder } from "../dist/riblt/index.js";

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

if (minHashSizing(0.05).k !== 100) {
  console.error(`smoke: minHashSizing(0.05) gave k=${minHashSizing(0.05).k}`);
  process.exit(1);
}

const mhA = MinHash.from(["x", "y", "z"], 0.05);
const mhB = MinHash.from(["z", "y", "x"], 0.05);
if (mhA.jaccard(mhB) !== 1 || !mhA.union(mhB).equals(mhA)) {
  console.error(`smoke: MinHash gave jaccard ${mhA.jaccard(mhB)} for one set`);
  process.exit(1);
}

if (!MinHash.fromBytes(mhA.toBytes()).equals(mhA)) {
  console.error("smoke: MinHash round-trip through toBytes lost state");
  process.exit(1);
}

const lsh = new MinHashLSH({ threshold: 0.5, k: mhA.k });
lsh.insert("a", mhA);
lsh.insert("b", mhB);
const candidates = lsh.query(mhA).sort().join(",");
if (candidates !== "a,b") {
  console.error(`smoke: MinHashLSH found [${candidates}] for two equal sets`);
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

const rebuild = ({
  kind,
  keys,
  epsilon,
  delta,
  p,
  n,
  growth,
  tightening,
  seed,
  deletes = [],
  values = [],
  maxBins,
  mapping,
  k,
  skip,
  symbols,
}) => {
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
      const filter = ScalableBloomFilter.create(n, epsilon, {
        growth,
        tightening,
        seed,
      });
      for (const key of keys) filter.add(key);
      return filter;
    }
    case "cuckoo": {
      const filter = CuckooFilter.create(n, epsilon, { seed });
      for (const key of keys) filter.add(key);
      for (const key of deletes) filter.delete(key);
      return filter;
    }
    case "countmin": {
      const sketch = CountMinSketch.create(epsilon, delta, { seed });
      for (const key of keys) sketch.add(key);
      return sketch;
    }
    case "topk": {
      const sketch = TopK.create(epsilon);
      for (const key of keys) sketch.add(key);
      return sketch;
    }
    case "ddsketch":
      return DDSketch.from(values, epsilon, {
        ...(maxBins ? { store: collapsingLowestStore(maxBins) } : {}),
        ...(mapping === "log" ? { mapping: logMapping } : {}),
      });
    case "minhash": {
      const sketch = new MinHash({ k, seed });
      for (const key of keys) sketch.add(key);
      return sketch;
    }
    case "riblt": {
      const encoder = RibltEncoder.from(keys, { seed });
      encoder.take(skip);
      const frame = encoder.take(symbols);
      return { toBytes: () => frame };
    }
    default:
      console.error(`smoke: unknown golden kind ${kind}`);
      process.exit(1);
  }
};

for (const entry of golden) {
  const { name, kind, frame } = entry;
  if (kind === "v2") continue;
  const actual = rebuild(entry).toBytes();
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

// A scalable filter must grow past its first stage and keep every key.
const grown = ScalableBloomFilter.create(10, 0.01);
const grownKeys = Array.from({ length: 30 }, (_, i) => `grow:${i}`);
for (const key of grownKeys) grown.add(key);
if (grown.stages < 2 || !grownKeys.every((key) => grown.has(key))) {
  console.error(
    `smoke: ScalableBloomFilter kept ${grown.stages} stage(s) or lost a key`,
  );
  process.exit(1);
}

// A cuckoo filter must delete: the deleted keys go, the rest stay.
const cuckoo = CuckooFilter.create(30, 0.01);
const cuckooKeys = Array.from({ length: 30 }, (_, i) => `cuckoo:${i}`);
for (const key of cuckooKeys) cuckoo.add(key);
for (const key of cuckooKeys.slice(0, 10)) cuckoo.delete(key);
if (
  cuckoo.count !== 20 ||
  !cuckooKeys.slice(10).every((key) => cuckoo.has(key))
) {
  console.error(
    `smoke: CuckooFilter held ${cuckoo.count} after deleting 10 of 30, or lost a kept key`,
  );
  process.exit(1);
}

const cms = CountMinSketch.create(0.001, 0.001);
cms.add("smoke", 3);
if (cms.count("smoke") < 3 || cms.total !== 3) {
  console.error(
    `smoke: CountMinSketch counted ${cms.count("smoke")} of 3, total ${cms.total}`,
  );
  process.exit(1);
}

const cmsSizing = countMinSizing(0.001, 0.001);
if (cmsSizing.width !== 2719 || cmsSizing.depth !== 7) {
  console.error(
    `smoke: countMinSizing gave ${cmsSizing.width}x${cmsSizing.depth}, want 2719x7`,
  );
  process.exit(1);
}

if (!CountMinSketch.fromBytes(cms.toBytes()).equals(cms)) {
  console.error("smoke: CountMinSketch did not survive a byte round-trip");
  process.exit(1);
}

const tk = TopK.create(0.01);
tk.add("smoke", 3);
const heaviest = tk.top(1)[0];
if (
  tk.count("smoke") < 3 ||
  tk.total !== 3 ||
  new TextDecoder().decode(heaviest?.key) !== "smoke"
) {
  console.error(
    `smoke: TopK counted ${tk.count("smoke")} of 3, total ${tk.total}, or lost the key from top`,
  );
  process.exit(1);
}

if (topKSizing(0.01).capacity !== 512) {
  console.error(
    `smoke: topKSizing(0.01) gave capacity ${topKSizing(0.01).capacity}, want 512`,
  );
  process.exit(1);
}

if (!TopK.fromBytes(tk.toBytes()).equals(tk)) {
  console.error("smoke: TopK did not survive a byte round-trip");
  process.exit(1);
}

const dd = DDSketch.create(0.01);
for (let v = 1; v <= 100; v++) dd.add(v);
const median = dd.quantile(0.5);
if (dd.count !== 100 || Math.abs(median - 50) > 0.5) {
  console.error(
    `smoke: DDSketch counted ${dd.count} of 100, or put the median at ${median}, not within 1% of 50`,
  );
  process.exit(1);
}

if (!DDSketch.fromBytes(dd.toBytes()).equals(dd)) {
  console.error("smoke: DDSketch did not survive a byte round-trip");
  process.exit(1);
}

if (dd.union(DDSketch.from([1000], 0.01)).max !== 1000) {
  console.error("smoke: DDSketch union lost the other sketch's max");
  process.exit(1);
}

const fromDatadog = fromProtobuf(toProtobuf(dd));
if (
  fromDatadog.count !== 100 ||
  Math.abs(fromDatadog.quantile(0.5) - 50) > 0.5
) {
  console.error(
    `smoke: DDSketch protobuf round trip counted ${fromDatadog.count} or moved the median to ${fromDatadog.quantile(0.5)}`,
  );
  process.exit(1);
}

// Two peers reconcile over frames from the built package: the decoder must
// report exactly the keys each side alone holds.
const ribltEncoder = RibltEncoder.from(["alice", "bob", "dave"]);
const ribltDecoder = RibltDecoder.from(["alice", "carol"]);
let ribltFrames = 0;
while (!ribltDecoder.push(ribltEncoder.take(4))) {
  if (++ribltFrames > 100) {
    console.error("smoke: RIBLT did not decode within 100 frames");
    process.exit(1);
  }
}
const ribltRemote = ribltDecoder.remote().sort();
const ribltExpected = ["bob", "dave"].map((k) => RibltDecoder.hashOf(k)).sort();
if (
  ribltDecoder.local().join() !== "carol" ||
  ribltRemote.join() !== ribltExpected.join()
) {
  console.error(
    `smoke: RIBLT decoded local [${ribltDecoder.local()}] and remote [${ribltRemote}]`,
  );
  process.exit(1);
}

// A log of concatenated frames must walk by declared length alone.
const log = [
  golden.find((g) => g.name === "bloom"),
  golden.find((g) => g.name === "hll-dense"),
].map((g) => decode(g.frame));
const stream = new Uint8Array(log[0].length + log[1].length);
stream.set(log[0], 0);
stream.set(log[1], log[0].length);
const walked = [];
let at = 0;
while (at < stream.length) {
  const frame = readFrameAt(stream, at);
  walked.push(frame.type);
  at += frame.byteLength;
}
if (walked.join() !== "1,5" || at !== stream.length) {
  console.error(
    `smoke: walking bloom + hll gave types [${walked}] ending at ${at} of ${stream.length}`,
  );
  process.exit(1);
}

console.log(
  `smoke ok: VERSION = ${VERSION}, distillate/bloom + distillate/blocked + distillate/fuse + distillate/hll + distillate/frame + distillate/scalable + distillate/cuckoo + distillate/countmin + distillate/topk + distillate/ddsketch + distillate/ddsketch/protobuf + distillate/minhash + distillate/riblt work (filters, sketches, sizing helpers, frame walk, growth, delete, counting, heavy hitters, quantiles, similarity, reconciliation), toBytes byte-identical to golden`,
);
