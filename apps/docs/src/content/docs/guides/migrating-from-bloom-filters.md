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

The Cuckoo implementation can report `false` for a key that was inserted.

**The consequence:** this is the one failure mode a membership filter must not
have. Every use of a filter, skipping a lookup, skipping a fetch, skipping a
write, is built on "no" being trustworthy. A false negative silently skips
work that was needed, and because it is silent you find out from a
downstream inconsistency rather than from an error.

distillate property-tests the no-false-negative guarantee for every structure
it ships. Its Cuckoo filter is [not yet
available](/guides/choosing-a-structure/), and it will ship with that property
test as its headline.

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
