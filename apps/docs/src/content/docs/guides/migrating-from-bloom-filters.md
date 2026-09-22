---
title: Migrating from bloom-filters
description: What the incumbent package costs you, what changes in your code, and what to do about serialized filters you already hold.
---

[`bloom-filters`](https://www.npmjs.com/package/bloom-filters) is the de facto
standard on npm, at roughly 493k downloads a week. It also predates most of
the runtimes people now deploy to, and that shows.

This page covers what the incumbent costs you, and what changes in your code.

## What the incumbent costs you

Every item below is a property of the published package, not a matter of
taste. Each one has a consequence you can feel.

### It is CommonJS only

`bloom-filters` declares `"type": "commonjs"` with a single `main` entry, no
`module` field, and no `exports` map.

**The consequence:** in an ESM project you get whatever your bundler's CJS
interop produces, and named imports may resolve at runtime rather than at
build time. In a runtime with no CJS loader at all, it does not load. There is
no ESM build to fall back to.

distillate ships ESM and CJS side by side with types for each, and an
`exports` map per structure.

### It is not tree-shakeable

There is no `sideEffects: false` and no per-structure entry point. Importing
`BloomFilter` pulls in `dist/api.js`, which reaches the Cuckoo filter,
HyperLogLog, Count-Min Sketch, Top-K, MinHash, and the rest.

**The consequence:** your bundle carries every structure in the library even
though you use one. On a browser or edge budget that is the difference between
shipping a filter and not shipping one.

distillate marks `sideEffects: false` and gives each structure its own
subpath, so `distillate/bloom` bundles the Bloom code and nothing else.

### It generates code dynamically, so it breaks on edge

It depends on `reflect-metadata` and `seedrandom`, both of which do dynamic
`eval`. `reflect-metadata` is loaded at module scope for the decorator-based
serialization.

**The consequence:** Cloudflare Workers, Vercel edge, and any runtime with a
strict Content Security Policy reject dynamic code generation. The failure is
at import time, before your code runs, so a filter is not something you can
retrofit into an edge worker with this package. There is no flag to turn it
off, because the metadata is how the library serializes.

distillate has no `eval` anywhere, no decorators, and no dependency that could
introduce one.

### It carries heavy dependencies

Eight runtime dependencies: `lodash`, `long`, `seedrandom`,
`reflect-metadata`, `xxhashjs`, `is-buffer`, `base64-arraybuffer`, and
`@types/seedrandom`, which is a types package listed as a runtime dependency.

**The consequence:** `lodash` alone is about 4.9 MB installed, against 780 KB
for `bloom-filters` itself. You inherit the whole tree's transitive install
cost, audit surface, and version churn to get one Bloom filter, and because
nothing is tree-shakeable, a good deal of it reaches your bundle too.

distillate has **zero** runtime dependencies.

### Its Cuckoo filter has a false-negative bug

The Cuckoo implementation can report `false` for a key that was inserted, and
not rarely. Filled to the size it was created for, about a third of the keys it
accepted read as absent: 370 of 1,000, 3,109 of 10,000, and 31% to 37% at every
size up to 10 million. Every one of those `add` calls returned `true`, and
deleting half the keys leaves about 30% of the rest missing (see the
[benchmark results](/bench/results/)).

The cause is in its eviction step (`cuckoo-filter.js`). A lookup derives a
key's second bucket from the key's full hash. When an eviction moves a
fingerprint, it derives the destination from the bucket index instead, which
has already been reduced `% size`, and it takes `Math.abs` of a signed 32-bit
XOR along the way. The two computations disagree, so a moved fingerprint lands
in a bucket its key never checks. At low load, where nothing is evicted, no
key goes missing, which is why small tests do not catch it.

**The consequence:** this is the one failure mode a membership filter must not
have. Every use of a filter, skipping a lookup, skipping a fetch, skipping a
write, is built on "no" being trustworthy. A false negative silently skips
work that was needed, and because it is silent you find out from a
downstream inconsistency rather than from an error.

distillate property-tests the no-false-negative guarantee for every structure
it ships. Its [Cuckoo filter](/guides/cuckoo/) derives the alternate bucket
from the fingerprint alone, a formula that returns to the first bucket when
applied twice, so a moved fingerprint always stays where its key looks.

### Its HyperLogLog is wrong for small counts

Its HyperLogLog has no working small-range correction, so it is off by about
half whenever the cardinality is below roughly `2.5 *` its register count.

**The consequence:** asked to count 1,000 distinct keys in a 16,384-register
sketch, it answers **504**. That is a 49.63% error on a number a caller has no
reason to distrust, and nothing about the call reports a problem. It is not
wrong everywhere, which is what makes it awkward: at 100k keys against the same
16,384 registers it measures 0.78%, and past that it behaves like any
HyperLogLog. The failure is confined to the low end, which is exactly where a
sketch is easiest to sanity-check against a real count and therefore easiest to
adopt on a small sample and ship at scale.

distillate answers 1,000 for that same input, and it does so for an unglamorous
reason: below the promotion threshold it is still storing sparse entries, so it
is counting rather than estimating. Its estimator is not better. Once it
promotes to dense registers it carries the same theoretical error as any
HyperLogLog at that precision, and the two sketches land within noise of each
other from 100k upward.

Both columns are measured at a matched register count over the same keys; see
[benchmark results](/bench/results/).

## What changes in your code

The common path is nearly identical.

| `bloom-filters`                    | distillate                           |
| ---------------------------------- | ------------------------------------ |
| `require("bloom-filters")`         | `import ... from "distillate/bloom"` |
| `BloomFilter.create(n, errorRate)` | `BloomFilter.create(n, epsilon)`     |
| `BloomFilter.from(items, rate)`    | `BloomFilter.from(items, epsilon)`   |
| `filter.add(item)`                 | `filter.add(key)`                    |
| `filter.has(item)`                 | `filter.has(key)`                    |
| `filter.saveAsJSON()`              | `filter.toJSON()`                    |
| `BloomFilter.fromJSON(obj)`        | `BloomFilter.fromJSON(obj)`          |
| (no equivalent)                    | `filter.toBytes()` / `fromBytes(b)`  |

Before:

```js
const { BloomFilter } = require("bloom-filters");

const filter = BloomFilter.create(100000, 0.01);
filter.add("alice");
filter.has("alice");
```

After:

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(100_000, 0.01);
filter.add("alice");
filter.has("alice");
```

`create(n, epsilon)` means the same thing in both: capacity and target false
positive rate.

### The cardinality sketch

`bloom-filters` also ships a HyperLogLog, and it maps across too. The one
difference worth reading is how the two are sized: it takes a register count,
distillate takes a precision `p`, and `2 ** p` is that register count.

| `bloom-filters`                | distillate                             |
| ------------------------------ | -------------------------------------- |
| `require("bloom-filters")`     | `import ... from "distillate/hll"`     |
| `new HyperLogLog(nbRegisters)` | `new HyperLogLog({ p })`               |
| `sketch.update(item)`          | `sketch.add(key)`                      |
| `sketch.count()`               | `sketch.count()`                       |
| `a.merge(b)`                   | `a.union(b)`                           |
| `sketch.saveAsJSON()`          | `sketch.toJSON()` / `sketch.toBytes()` |

Before:

```js
const { HyperLogLog } = require("bloom-filters");

const sketch = new HyperLogLog(16384);
sketch.update("alice");
sketch.count();
```

After:

```ts
import { HyperLogLog } from "distillate/hll";

const sketch = new HyperLogLog({ p: 14 });
sketch.add("alice");
sketch.count();
```

`16384` registers is `p = 14`, so the two sketches above carry the same
theoretical error.

`merge` and `union` differ in one way that matters if you combine sketches from
different sources. `bloom-filters` requires both sides to have the same register
count and throws otherwise. `union` accepts any two precisions and folds the
result down to the coarser precision of the pair, because a finer sketch reduces
cleanly while the reverse would invent detail it never recorded.

### The scalable filter

`bloom-filters` also ships a `ScalableBloomFilter`, and it maps across. The
calls line up one for one; the behaviour behind them does not, in three ways
worth knowing before you switch.

| `bloom-filters`                                          | distillate                                               |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `require("bloom-filters")`                               | `import ... from "distillate/scalable"`                  |
| `new ScalableBloomFilter(initialSize, errorRate, ratio)` | `new ScalableBloomFilter({ n, epsilon, tightening })`    |
| `ScalableBloomFilter.create(size, errorRate, ratio)`     | `ScalableBloomFilter.create(n, epsilon, { tightening })` |
| `filter.add(item)`                                       | `filter.add(key)`                                        |
| `filter.has(item)`                                       | `filter.has(key)`                                        |
| `filter.capacity()`                                      | `filter.capacity` (a getter)                             |
| `filter.rate()`                                          | `filter.rate()`, covering every stage                    |
| `a.equals(b)`                                            | `a.equals(b)`                                            |
| `filter.saveAsJSON()` / `ScalableBloomFilter.fromJSON()` | `filter.toJSON()` / `ScalableBloomFilter.fromJSON()`     |
| `filter.seed = s`                                        | `{ seed: s }` at construction                            |

Before:

```js
const { ScalableBloomFilter } = require("bloom-filters");

const filter = ScalableBloomFilter.create(1000, 0.01, 0.5);
filter.add("alice");
filter.has("alice");
```

After:

```ts
import { ScalableBloomFilter } from "distillate/scalable";

const filter = ScalableBloomFilter.create(1000, 0.01, { tightening: 0.5 });
filter.add("alice");
filter.has("alice"); // true
```

The differences, as its source (`scalable-bloom-filter.js`) shows them:

- **Its bound is not the rate you asked for.** Its first stage targets the full
  `errorRate` and each later one `errorRate * ratio ** i`, so the stages sum to
  `errorRate / (1 - ratio)`: twice the requested rate at its default `ratio` of
  0.5. distillate starts at `epsilon * (1 - tightening)`, so the whole chain
  holds `epsilon`. `tightening` is the counterpart of `ratio`. Measured at a
  hundred times its initial size, it reaches 1.60% where distillate stays at
  0.99%, both asked for 1% (see the
  [benchmark results](/bench/results/)).
- **Its `rate()` reports only the newest stage**, not the chain a lookup
  actually checks. distillate's `rate()` combines every stage.
- **Its growth is fixed at 2.** distillate takes a `growth` option.

It also has no `union`; distillate merges two chains built with the same
settings.

### The cuckoo filter

`bloom-filters`' `CuckooFilter` maps across, with two changes in behaviour
beyond the bug above. Its `add` returns `false` when the filter is full, which
is easy to ignore; distillate's throws `CuckooFullError` and leaves the filter
unchanged. And bucket size and kick limit are fixed rather than options.

| `bloom-filters`                                              | distillate                                       |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `require("bloom-filters")`                                   | `import ... from "distillate/cuckoo"`            |
| `new CuckooFilter(size, fLength, bucketSize, maxKicks)`      | `new CuckooFilter({ n, epsilon })`               |
| `CuckooFilter.create(size, errorRate, bucketSize, maxKicks)` | `CuckooFilter.create(n, epsilon)`                |
| `CuckooFilter.from(items, errorRate)`                        | `CuckooFilter.from(keys, epsilon)`               |
| `filter.add(item)`, `false` when full                        | `filter.add(key)`, throws `CuckooFullError`      |
| `filter.remove(item)`                                        | `filter.delete(key)`                             |
| `filter.has(item)`                                           | `filter.has(key)`                                |
| `filter.rate()`                                              | `filter.rate()`                                  |
| `a.equals(b)`                                                | `a.equals(b)`                                    |
| `filter.saveAsJSON()` / `CuckooFilter.fromJSON()`            | `filter.toJSON()` / `CuckooFilter.fromJSON()`    |
| `filter.length`                                              | `filter.count`                                   |
| `filter.size`                                                | `filter.buckets`                                 |
| `filter.fullSize`                                            | `filter.capacity`                                |
| `filter.fingerprintLength`                                   | `filter.fingerprintBits`, derived from `epsilon` |
| `filter.bucketSize`                                          | fixed at 4                                       |
| `filter.maxKicks`                                            | fixed at 500                                     |
| `filter.seed = s`                                            | `{ seed: s }` at construction                    |

Before:

```js
const { CuckooFilter } = require("bloom-filters");

const filter = CuckooFilter.create(1000, 0.01);
filter.add("alice");
filter.remove("alice");
filter.has("alice");
```

After:

```ts
import { CuckooFilter } from "distillate/cuckoo";

const filter = CuckooFilter.create(1000, 0.01);
filter.add("alice");
filter.delete("alice"); // true
filter.has("alice"); // false
```

Both delete one copy of a key per call, and in both a delete of a key you never
added can remove another key's fingerprint, so only delete keys you added.

### Serialized filters do not carry over

The two formats are unrelated. distillate cannot read a `bloom-filters`
JSON dump, and it will not pretend to: a foreign frame is rejected with
[`BadMagicError`](/reference/errors/) rather than misparsed.

Rebuild from the source keys. If you no longer have them, keep the old filter
in place for reads and build the distillate one alongside until the old one
ages out.

### Sizing is explicit if you want it

`bloom-filters` hides the geometry. distillate exposes it, so you can inspect
the cost before allocating:

```ts
import { bloomSizing } from "distillate/bloom";

bloomSizing(100_000, 0.01); // { m: 958506, k: 7 }
```

See [sizing and tuning](/guides/sizing/).

## While you are here, reconsider the structure

Classic Bloom is the drop-in, and
[the migration guide's default](/guides/bloom/). But if you are touching this
code anyway:

- **Static key set?** [Binary Fuse](/guides/fuse/) is about 9 bits per key at
  0.39%, against 11.5 for classic at the same rate, and faster to query.
- **Lookups dominate and the filter is large?**
  [Blocked Bloom](/guides/blocked/) touches one cache line instead of `k`.
- **Migrating a `ScalableBloomFilter`?** If you can bound your key count,
  a [Classic Bloom](/guides/bloom/) sized for it is smaller and faster. If you
  cannot, [Scalable Bloom](/guides/scalable/) is the direct replacement, and
  it holds the rate you ask for.
- **Migrating a `CuckooFilter` you never delete from?** A
  [Classic Bloom](/guides/bloom/) is smaller at common targets. If you do
  delete, [Cuckoo](/guides/cuckoo/) is the direct replacement.
- **Migrating a HyperLogLog?** You gave the old one a register count. Pick the
  precision that produces it, or the error you actually want, in
  [choose a precision](/guides/hll/#choose-a-precision).

[Choosing a structure](/guides/choosing-a-structure/) maps this out.

## What you gain in throughput

At a matched 1% false positive rate over the same 100k keys, measured by
identical code:

| Classic Bloom  | bits/key | measured FPR | `has` throughput |
| -------------- | -------- | ------------ | ---------------- |
| **distillate** | 9.59     | 1.01%        | ~21.8 M ops/s    |
| bloom-filters  | 9.59     | 0.99%        | ~0.29 M ops/s    |

Same space, same accuracy, roughly 75 times the lookup throughput. Method and
the full report: [benchmark results](/bench/results/) and
[methodology](/bench/methodology/).

### And in cardinality

Sketches are matched on register count rather than on bytes, so both carry the
same theoretical error and space is left as the differentiator. Counting
10,000,000 distinct keys at `m = 16384`:

| HyperLogLog    | build time | serialized     | rel. error |
| -------------- | ---------- | -------------- | ---------- |
| **distillate** | 0.63 s     | 12314 B binary | 0.15%      |
| bloom-filters  | 1164.62 s  | 40247 B json   | 0.41%      |

Both land inside the theoretical error at this cardinality, so accuracy is not
the difference here; build time and space are. The two sizes are different
encodings, binary against JSON, and distillate's does not grow: it is the same
12314 bytes at 10,000 distinct keys as at 10,000,000, where the incumbent's JSON
climbs from 32904 to 40247 bytes over that range.
