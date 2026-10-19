---
title: Choosing a structure
description: A decision matrix mapping each membership workload onto the filter that fits it, the sketches for counting, set operations, frequency, percentiles and similarity, and what is not shipped yet.
---

First, which question are you asking?

- **"Have I seen this key?"** A membership filter. Read on.
- **"How many distinct keys have I seen?"** A cardinality sketch:
  [HyperLogLog](/guides/hll/). No filter can answer this, and no sketch can
  answer the first.
- **"How many are in both, or in one but not the other?"** A set-operations
  sketch: [Theta](/guides/theta/). It counts distinct keys like HyperLogLog,
  and its sketches also intersect and subtract, which HyperLogLog's cannot.
- **"How many times have I seen this key?"** A frequency sketch:
  [Count-Min](/guides/countmin/). It attributes a number to a key you name,
  which neither a filter nor HyperLogLog can do.
- **"Which keys have I seen most?"** A heavy-hitters sketch:
  [Top-K](/guides/topk/). It lists the heaviest keys without you naming them,
  which Count-Min cannot do because it holds no keys.
- **"What is the p99 of these values?"** A quantile sketch:
  [DDSketch](/guides/ddsketch/). It takes numbers rather than keys, and every
  quantile it reports is within a relative error of the true value.
- **"How similar are these two sets?"** A similarity sketch:
  [MinHash](/guides/minhash/). It compares two sets at once, and its index
  finds near-duplicates among many without comparing every pair.
- **"Which keys do we not share?"** Set reconciliation:
  [RIBLT](/guides/riblt/). Two peers holding similar sets find exactly the keys
  that differ, at a cost that follows the difference rather than the sets.

There is no best filter, only a best filter for a workload. Answer three
questions and the choice is usually forced:

1. **Does the key set change after you build it?** If not, a static structure
   is smaller and faster than any mutable one.
2. **Do you need to remove keys?** Bloom variants cannot. That is structural,
   not a missing feature.
3. **How low does the false positive rate have to go?** Below roughly 1e-5 the
   structures reorder.

## Decision matrix

| Workload                                  | Use                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Static set, built once, queried a lot     | [Binary Fuse 8](/guides/fuse/) (Fuse 16 for a lower FPR)                        |
| Squeeze every bit, static, RAM-bound      | Ribbon/BuRR **(not yet available)**                                             |
| Streaming inserts, speed-first, no delete | [Blocked Bloom](/guides/blocked/)                                               |
| Inserts and deletes                       | [Cuckoo](/guides/cuckoo/)                                                       |
| Unbounded growth, `n` unknown             | [Scalable Bloom](/guides/scalable/); InfiniFilter/Aleph **(not yet available)** |
| Very low FPR (1e-4 or below)              | [Binary Fuse 16](/guides/fuse/)                                                 |
| Migrating from `bloom-filters`            | [Classic Bloom](/guides/bloom/)                                                 |
| Counting distinct keys, not membership    | [HyperLogLog](/guides/hll/)                                                     |
| Distinct counts to intersect or subtract  | [Theta](/guides/theta/)                                                         |
| Counting how often each key appears       | [Count-Min](/guides/countmin/)                                                  |
| Finding the most frequent keys            | [Top-K](/guides/topk/)                                                          |
| Latency or size percentiles               | [DDSketch](/guides/ddsketch/)                                                   |
| Near-duplicates, or how much sets overlap | [MinHash](/guides/minhash/)                                                     |
| Syncing two sets that mostly agree        | [RIBLT](/guides/riblt/)                                                         |

For the filters, space below is stated as overhead over the
information-theoretic floor of `log2(1/epsilon)` bits per key: 6.64 bits/key at
a 1% FPR, 9.97 at 0.1%. A sketch has no per-key cost to state, its size being
fixed before it sees a key: by precision for HyperLogLog, by the error bound
for Count-Min and Top-K, by the accuracy and the range of values for DDSketch,
by the slot count for MinHash, by `k` for Theta.

## What ships today

### [HyperLogLog](/guides/hll/) (`distillate/hll`)

Not a filter. Counts distinct keys in space fixed by precision rather than by
the answer: 12 KiB at `p = 14` holds a count of a thousand or a billion at
about 0.8% relative error. Exact below a few thousand keys, and mergeable, so
per-shard rollups combine without double-counting the overlap.

Reach for it for distinct users, distinct IPs, distinct cache keys, and any
other "how many different" question. It cannot tell you whether it saw a
particular key; nothing in a sketch records membership.

### [Theta](/guides/theta/) (`distillate/theta`)

Not a filter. Counts distinct keys, and its sketches combine by union,
intersection and difference, so "users in both segments" or "in one but not
the other" is answered from sketches stored apart. Exact up to `k` keys (4096
by default), within about `1 / sqrt(k)` past that, with lower and upper bounds.

Reach for it over HyperLogLog when counts will be intersected or subtracted
later: HyperLogLog is smaller, but an overlap estimated from its unions drowns
in their error when the overlap is small.

### [Top-K](/guides/topk/) (`distillate/topk`)

Not a filter. Lists the keys seen most often, in a table capped by the error
you ask for: at most 512 slots at `epsilon` 0.01, 6 KiB plus the keys it holds,
whether the stream is a thousand events or a billion. A key it holds never reads below its
true count, and any key heavier than the error is guaranteed to be held.

Reach for it for the hottest routes, the noisiest clients, the most searched
terms: any "which ones" question where you cannot name the candidates in
advance. It keeps the keys themselves, so a serialized sketch holds user input.

### [DDSketch](/guides/ddsketch/) (`distillate/ddsketch`)

Not a filter, and not keyed: records numbers and reports any quantile within a
relative error of the true value, 1% by default, at p50 and p99.9 alike. Its
bins cover the range of values on a logarithmic scale, so a million latencies
between 1 ms and 10 s take the same space as a thousand. Merges are exact, and
`distillate/ddsketch/protobuf` reads and writes the message Datadog's libraries
exchange.

Reach for it for request latencies, payload sizes, queue depths: any "what is
the p99" question over a stream you cannot keep in full.

### [MinHash](/guides/minhash/) (`distillate/minhash`)

Not a filter. Sketches a set into `k` slots, a 540-byte frame at the default
128, and estimates the Jaccard similarity of two sets from their sketches alone. Each
item costs one hash, and sketches merge exactly. `MinHashLSH` indexes sketches
by band, so a query finds the stored sets likely to resemble it without
comparing against every one.

Reach for it for near-duplicate documents, records or chunks, and for "how much
do these two audiences or baskets overlap" questions. It does not count items
or report whether one is present.

### [RIBLT](/guides/riblt/) (`distillate/riblt`)

Not a filter or a sketch. Encodes a set into an endless stream of 20-byte coded
symbols; a peer holding a similar set pushes them into a decoder until it
decodes, then holds the exact keys each side alone has. A large difference costs
about 1.36 symbols per differing key, and nobody estimates its size first.

Reach for it when two parties keep sets that mostly agree and must converge:
offline clients reconnecting, replicas catching up, peers syncing. It answers
nothing about one set alone.

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

### [Scalable Bloom](/guides/scalable/) (`distillate/scalable`)

Mutable, insert-only. A chain of Bloom stages that opens a larger, tighter one
each time the newest fills, so it holds `epsilon` for a key count nobody knew
up front. It pays for that in space, about 13.5 bits/key for its first stage
at a 1% FPR against 9.6 for a Classic Bloom sized for the same `n`, and in
lookups that check every stage.

Reach for it when `n` is a guess: a stream, a crawler's seen-URL set, a dedup
set that keeps growing. If you can size the filter, Classic Bloom is smaller
and faster.

### [Cuckoo](/guides/cuckoo/) (`distillate/cuckoo`)

Mutable, with delete. Fingerprints in buckets of four, each key in one of two
candidate buckets, so a key can be taken back out without disturbing the
others. About `log2(1/epsilon) + 3` bits/key at 95% load, which makes it larger
than a Classic Bloom at common targets (10.65 bits/key against 9.59 at 1%) and
smaller only at about 0.2% and below. An add into a full filter throws and
leaves the filter unchanged rather than dropping a key.

Reach for it when keys leave the set as well as join it: expiring sessions,
revoked tokens, evicted cache entries. Delete only keys you added; a delete of a
key that was never added can remove another key's fingerprint.

## What is not shipped yet

These are on the roadmap. None of them exist in the package today, and none
have a guide, so do not plan around them.

- **Counting Bloom** _(not yet available)_. Four-bit counters buy delete at
  about four times the space. Mainly for parity with incumbent packages.
- **Ribbon / Homogeneous / BuRR** _(not yet available)_. A banded linear
  system with sub-1% space overhead, the minimum-space static option. Post-1.0.
- **InfiniFilter / Aleph** _(not yet available)_. Expandable mutable filters
  that grow in constant time, for unknown-cardinality streams. Post-1.0.
- **XOR 8/16** _(not yet available)_. Superseded by Binary Fuse, which is both
  smaller and faster. Of interest only for benchmark comparison.

## Next

- [Sizing and tuning FPR](/guides/sizing/) to pick `epsilon` and a budget.
- [Migrating from bloom-filters](/guides/migrating-from-bloom-filters/).
