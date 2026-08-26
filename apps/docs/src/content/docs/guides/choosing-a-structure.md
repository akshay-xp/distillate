---
title: Choosing a structure
description: A decision matrix mapping each membership workload onto the filter that fits it, and what is not shipped yet.
---

First, which question are you asking?

- **"Have I seen this key?"** A membership filter. Read on.
- **"How many distinct keys have I seen?"** A cardinality sketch:
  [HyperLogLog](/guides/hll/). No filter can answer this, and no sketch can
  answer the first.

There is no best filter, only a best filter for a workload. Answer three
questions and the choice is usually forced:

1. **Does the key set change after you build it?** If not, a static structure
   is smaller and faster than any mutable one.
2. **Do you need to remove keys?** Bloom variants cannot. That is structural,
   not a missing feature.
3. **How low does the false positive rate have to go?** Below roughly 1e-5 the
   structures reorder.

## Decision matrix

| Workload                                  | Use                                                             |
| ----------------------------------------- | --------------------------------------------------------------- |
| Static set, built once, queried a lot     | [Binary Fuse 8](/guides/fuse/) (Fuse 16 for a lower FPR)        |
| Squeeze every bit, static, RAM-bound      | Ribbon/BuRR **(not yet available)**                             |
| Streaming inserts, speed-first, no delete | [Blocked Bloom](/guides/blocked/)                               |
| Inserts and deletes                       | Cuckoo **(not yet available)**                                  |
| Unbounded growth, `n` unknown             | Scalable Bloom, then InfiniFilter/Aleph **(not yet available)** |
| Very low FPR (1e-4 or below)              | [Binary Fuse 16](/guides/fuse/)                                 |
| Migrating from `bloom-filters`            | [Classic Bloom](/guides/bloom/)                                 |
| Counting distinct keys, not membership    | [HyperLogLog](/guides/hll/)                                     |

For the filters, space below is stated as overhead over the
information-theoretic floor of `log2(1/epsilon)` bits per key: 6.64 bits/key at
a 1% FPR, 9.97 at 0.1%. A sketch has no per-key cost to state, its size being
fixed by precision before it sees a key.

## What ships today

### [HyperLogLog](/guides/hll/) (`distillate/hll`)

Not a filter. Counts distinct keys in space fixed by precision rather than by
the answer: 12 KiB at `p = 14` holds a count of a thousand or a billion at
about 0.8% relative error. Exact below a few thousand keys, and mergeable, so
per-shard rollups combine without double-counting the overlap.

Reach for it for distinct users, distinct IPs, distinct cache keys, and any
other "how many different" question. It cannot tell you whether it saw a
particular key; nothing in a sketch records membership.

### [Binary Fuse 8 and 16](/guides/fuse/) (`distillate/fuse`)

Static. Built once from the whole key set, then immutable. About 1.08 to 1.13
times the floor, roughly 9% overhead, which is the least of anything in the
lineup, and three cache-local probes per query. Fuse 8 gives an FPR near
0.39%, Fuse 16 near 1/65536. No `add`, no `delete`: to change membership you
rebuild from the new set.

Reach for it whenever the set is known up front. It is the default for
read-heavy workloads.

### [Blocked Bloom](/guides/blocked/) (`distillate/blocked`)

Mutable, insert-only. One cache line per lookup instead of the `k` scattered
probes classic makes, so lookups stay fast once the filter outgrows cache: at
30M keys its hit path is about 1.5 times faster than classic. It pays roughly
20 to 30% more space than classic for that.

Reach for it for streaming inserts where lookup throughput matters and you
never delete.

### [Classic Bloom](/guides/bloom/) (`distillate/bloom`)

Mutable, insert-only. Fixed at 1.44 times the floor, a 44% overhead, and it
has been that way since 1970. Ubiquitous, zero build risk, mergeable with
`union` at equal parameters.

Reach for it when you are migrating from another Bloom package, when space is
tighter than lookup latency, or when you want the FPR curve everyone already
knows. Below about 1e-5 it also beats blocked outright, on both space and
rate. See [sizing and tuning](/guides/sizing/).

## What is not shipped yet

These are on the roadmap. None of them exist in the package today, and none
have a guide, so do not plan around them.

- **Cuckoo** _(not yet available)_. Fingerprints in a cuckoo table, buckets of
  four, partial-key hashing. The only planned structure that supports delete.
  Roughly `log2(1/epsilon) + 3` bits/key and two bucket probes. Inserts can
  fail near the load cap, so it must signal rather than corrupt.
- **Scalable Bloom** _(not yet available)_. A chain of Bloom filters for
  unbounded growth when `n` is unknown at build time.
- **Counting Bloom** _(not yet available)_. Four-bit counters buy delete at
  about four times the space. Mainly for parity with incumbent packages.
- **Ribbon / Homogeneous / BuRR** _(not yet available)_. A banded linear
  system with sub-1% space overhead, the minimum-space static option. Post-1.0.
- **InfiniFilter / Aleph** _(not yet available)_. Expandable mutable filters
  that grow in constant time, for unknown-cardinality streams. Post-1.0.
- **XOR 8/16** _(not yet available)_. Superseded by Binary Fuse, which is both
  smaller and faster. Of interest only for benchmark comparison.

Until Cuckoo lands there is no delete anywhere in the library. If you need to
remove keys, rebuild the filter from the current set.

## Next

- [Sizing and tuning FPR](/guides/sizing/) to pick `epsilon` and a budget.
- [Migrating from bloom-filters](/guides/migrating-from-bloom-filters/).
