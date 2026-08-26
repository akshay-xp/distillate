---
title: Classic Bloom
description: The familiar Bloom filter, mutable and mergeable, fixed at 1.44 times the space floor. The migration target and the right pick at very low FPRs.
---

`distillate/bloom` ships the Bloom filter as published in 1970: a bit array
and `k` hash probes per key. It is the most familiar structure in the lineup
and the one to reach for when you are moving off another Bloom package.

- **Mutable**, insert-only. No delete.
- **Mergeable** with `union` at identical parameters.
- **1.44 times the floor**, a 44% space overhead, fixed forever.

Bloom, CACM 1970.

## Build one

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(100_000, 0.01); // capacity, target FPR

filter.add("alice");
filter.has("alice"); // true
filter.has("bob"); // false, or a ~1% false positive
```

`create(n, epsilon)` solves for the geometry. To build from a key set you
already hold, `from` does both steps at once:

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.from(["alice", "bob", "carol"], 0.01);
filter.has("alice"); // true
```

Both take `epsilon` as a target for `n` keys. Add more than `n` and the real
rate climbs past it.

## Control the geometry directly

`create` is a wrapper over the analytic solve. When you need the exact `m` and
`k`, for instance to match a filter produced elsewhere, size and construct
separately:

```ts
import { BloomFilter, bloomSizing } from "distillate/bloom";

const { m, k } = bloomSizing(100_000, 0.01); // { m: 958506, k: 7 }
const filter = new BloomFilter({ m, k, seed: 0 });

filter.m; // 958506
filter.k; // 7
```

`seed` defaults to `0`. Two filters must agree on `m`, `k`, and `seed` to be
merged or compared.

## Inspect it

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(100_000, 0.01);
filter.add("alice");

filter.length; // bits currently set, 7 after one key
filter.m; // bits in the array
filter.k; // probes per key
filter.seed; // 0
filter.bitsPerKey; // design m / n, ~9.59
filter.rate(); // estimated FPR at the current fill
```

`rate()` measures the filter as it stands right now, not the design target. It
rises as you add keys, so it is the honest signal that you have overshot `n`.

## Merge two filters

`union` OR-merges the bit arrays and returns a new filter. Both sides must
have been built with the same `m`, `k`, and `seed`, or it throws
[`BloomParamMismatchError`](/reference/errors/):

```ts
import { BloomFilter } from "distillate/bloom";

const a = BloomFilter.create(1000, 0.01);
const b = BloomFilter.create(1000, 0.01);
a.add("alice");
b.add("bob");

const merged = a.union(b);
merged.has("alice"); // true
merged.has("bob"); // true
```

This is what makes classic Bloom the easy choice for map-reduce shapes: build
a filter per shard, merge at the end.

## Persist it

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(1000, 0.01);
filter.add("alice");

const bytes = filter.toBytes();
const restored = BloomFilter.fromBytes(bytes);

restored.equals(filter); // true
```

`toJSON` and `fromJSON` wrap the same frame in a base64 envelope for transport
that cannot carry bytes. Frames are DSTL type 1; the layout is fixed in
[serialization](/reference/serialization/).

## When to pick it

Pick classic Bloom when:

- You are migrating from `bloom-filters` or another Bloom package and want the
  same structure with the same curve. See
  [migrating](/guides/migrating-from-bloom-filters/).
- Space matters more than lookup latency. Classic is about 20 to 30% smaller
  than blocked at the same rate.
- Your target FPR is below about 1e-5, where blocked costs more bits per key
  for a worse rate. See [sizing and tuning](/guides/sizing/).

Pick something else when:

- Lookups dominate and the filter is bigger than cache. Use
  [Blocked Bloom](/guides/blocked/), which touches one cache line instead of
  `k`.
- The key set is fixed at build time. Use [Binary Fuse](/guides/fuse/), which
  is smaller than either Bloom.

## Performance

At a matched 1% FPR over the same 100k keys, measured by identical code
against `bloom-filters`:

| Classic Bloom  | bits/key | measured FPR | `has` throughput |
| -------------- | -------- | ------------ | ---------------- |
| **distillate** | 9.59     | 1.01%        | ~21.8 M ops/s    |
| bloom-filters  | 9.59     | 0.99%        | ~0.29 M ops/s    |

Same space, same accuracy, roughly 75 times the lookup throughput. Full report
and method: [benchmark results](/bench/results/) and
[methodology](/bench/methodology/).
