---
title: Blocked Bloom
description: A split-block Bloom filter that touches one cache line per lookup, trading roughly 20 to 30 percent more space for markedly faster queries.
---

`distillate/blocked` ships a split-block Bloom filter. Classic Bloom scatters
`k` probes across the whole bit array, so a large filter pays `k` cache
misses per lookup. Blocked confines every key to a single 256-bit block, so a
lookup touches **one cache line**.

- **Mutable**, insert-only. No delete.
- **Mergeable** with `union` at identical parameters.
- **Roughly 20 to 30% more space** than classic, bought back in speed.

Putze, Sanders, Singler, JEA 2009.

## Build one

```ts
import { BlockedBloomFilter } from "distillate/blocked";

const filter = BlockedBloomFilter.create(100_000, 0.01); // capacity, target FPR

filter.add("alice");
filter.has("alice"); // true
filter.has("bob"); // false, or a ~1% false positive
```

The surface matches [Classic Bloom](/guides/bloom/) exactly: `add`, `has`,
`union`, `toBytes`, `fromBytes`, `bitsPerKey`. Switching between them is a
change of import.

`from` builds and sizes in one step:

```ts
import { BlockedBloomFilter } from "distillate/blocked";

const filter = BlockedBloomFilter.from(["alice", "bob", "carol"], 0.01);
filter.has("alice"); // true
```

## Control the geometry directly

```ts
import { BlockedBloomFilter, blockedBitsPerKey } from "distillate/blocked";

const bitsPerKey = blockedBitsPerKey(0.01); // 11
const filter = new BlockedBloomFilter({ bitsPerKey, capacity: 100_000 });

filter.bitsPerKey; // actual bits allocated per key
filter.numBlocks; // 256-bit blocks
filter.seed; // 0
```

`create` is exactly this: solve `blockedBitsPerKey(epsilon)`, then construct.
Targets below the solvable floor near 1e-8 throw
[`ParamError`](/reference/errors/) instead of silently under-provisioning. See
[sizing and tuning](/guides/sizing/).

## How the layout works

A block is 256 bits laid out as eight 32-bit lanes. A key sets exactly one bit
in each lane, so `k` is fixed at 8 and every probe lands in the same block.
Block selection and the eight lane bits all come from one `hash128`, using
Lemire's `reduce` for the block index, so a lookup is one hash and one cache
line.

This is the Parquet and Impala split-block layout, but distillate does not aim
for byte compatibility with them: it reuses its own `hash128` rather than
XXH64, so frames are native only.

The consequence for accuracy is that the FPR is not linear in
`log10(1/epsilon)`. Keys cluster into blocks by a Poisson distribution, and an
unluckily full block is much worse than an average one. `blockedFprAt` models
that clustering directly rather than assuming an even spread.

## Inspect it

```ts
import { BlockedBloomFilter } from "distillate/blocked";

const filter = BlockedBloomFilter.create(100_000, 0.01);
filter.add("alice");

filter.length; // bits currently set across all lanes
filter.numBlocks; // 256-bit blocks allocated
filter.bitsPerKey; // total bits / capacity
filter.rate(); // estimated FPR at the current fill
```

`rate()` uses an exponent of 8, not a classic `k`, because a split-block query
checks exactly eight lane bits.

## Merge two filters

`union` requires both sides to agree on `numBlocks` and `seed`, or it throws
[`BlockedBloomParamMismatchError`](/reference/errors/):

```ts
import { BlockedBloomFilter } from "distillate/blocked";

const a = BlockedBloomFilter.create(1000, 0.01);
const b = BlockedBloomFilter.create(1000, 0.01);
a.add("alice");
b.add("bob");

const merged = a.union(b);
merged.has("alice"); // true
merged.has("bob"); // true
```

## Persist it

```ts
import { BlockedBloomFilter } from "distillate/blocked";

const filter = BlockedBloomFilter.create(1000, 0.01);
filter.add("alice");

const bytes = filter.toBytes();
const restored = BlockedBloomFilter.fromBytes(bytes);

restored.equals(filter); // true
```

Frames are DSTL type 2. The lane words are a `Uint32Array` copied verbatim, so
see [serialization](/reference/serialization/) for the byte-order note.

## Performance

The cache-line advantage only appears once the filter outgrows cache. Package
microbenchmark, Apple M5, node v24.14.1:

| n    | operation    | blocked | classic | ratio |
| ---- | ------------ | ------- | ------- | ----- |
| 100k | `add`        | ~40 ns  | ~44 ns  | ~1.1x |
| 100k | `has` (hit)  | ~40 ns  | ~47 ns  | ~1.2x |
| 100k | `has` (miss) | ~49 ns  | ~51 ns  | ~1.0x |
| 30M  | `has` (hit)  | ~75 ns  | ~114 ns | ~1.5x |
| 30M  | `has` (miss) | ~90 ns  | ~103 ns | ~1.1x |

At 100k keys and a 1% FPR the whole filter fits in cache, so classic's probes
stay in L1 and the two structures are close. At 30M keys classic is about
36 MB, past the M5 performance-core L2, and blocked pulls ahead.

## When to pick it

Pick blocked when lookups dominate, the filter is larger than cache, and you
never delete.

Pick something else when:

- Space is tighter than latency. [Classic Bloom](/guides/bloom/) is 20 to 30%
  smaller at the same target.
- Your target FPR is below about 1e-5. The split-block clustering penalty
  compounds there, so blocked costs **more** bits per key than classic for a
  **worse** rate. Use classic or a fuse filter instead.
- The key set is fixed at build time. [Binary Fuse](/guides/fuse/) is smaller
  and faster than both.
