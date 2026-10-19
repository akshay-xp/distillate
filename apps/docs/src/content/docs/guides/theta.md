---
title: Theta
description: A distinct-count sketch that combines by union, intersection and difference, so overlaps between segments are answered from stored sketches.
---

`distillate/theta` ships the Theta sketch, which answers "how many distinct
keys?" for one set, and for any union, intersection or difference of sets
sketched apart. Keep one sketch per segment, day or source, and ask later how
many users were in both, or in one but not the other, without the raw keys.

- **Exact while small.** Up to `k` distinct keys, 4096 by default, the count is
  exact.
- **Sampled past that.** It keeps the `k` smallest key hashes and estimates
  within about `1 / sqrt(k)`, with bounds that say how far off it may be.
- **Combines both ways.** `union`, `intersect` and `difference` each return an
  ordinary sketch, which takes more keys and further operations.

## Count and combine

```ts
import { ThetaSketch } from "distillate/theta";

const ids = (from: number, to: number): string[] =>
  Array.from({ length: to - from }, (_, i) => `user:${String(from + i)}`);

const web = ThetaSketch.from(ids(0, 60_000), 0.02); // within 2%
const app = ThetaSketch.from(ids(50_000, 80_000), 0.02);

web.k; // 4096
web.count(); // ~60537
web.union(app).count(); // ~79786
web.intersect(app).count(); // ~9888
web.difference(app).count(); // ~50649
```

The two segments share 10,000 of 80,000 users. `ThetaSketch.create(relativeError)`
sizes an empty sketch the same way, `new ThetaSketch({ k, seed })` takes `k`
directly (a power of two from 16 to 2^26), and `add(key)` records one key: a
string, `Uint8Array` or `ArrayBuffer`. `thetaSizing(relativeError)` gives the
`k` without building anything.

## When to pick it

Pick Theta when counts will be combined after the fact: users in this campaign
and that one, sessions on web but not on the app, keys left after a filter.
[HyperLogLog](/guides/hll/) counts one set in less space, and merges by union,
but cannot intersect or subtract. Estimating an overlap from it by
inclusion-exclusion, `|A| + |B| - |A ∪ B|`, carries the error of all three
counts, which scales with the union rather than the overlap: a small overlap
drowns in it. Theta samples the same hashes on both sides, so an intersection
is estimated from the keys the two sketches share.

When the only question is how many distinct keys one stream held, HyperLogLog
is the smaller choice. When it is how similar two sets are,
[MinHash](/guides/minhash/) answers it and indexes near-duplicates. See
[choosing a structure](/guides/choosing-a-structure/).

## Set operations

`a.union(b)`, `a.intersect(b)` and `a.difference(b)` (the keys in `a` and not
in `b`) leave both inputs untouched and return a new sketch. Each keeps the
hashes below the smaller of the two sketches' sampling bounds, `theta`, so both
sides are compared over the same slice of hash space. Chains work as on sets:

```ts
import { ThetaSketch } from "distillate/theta";

const monday = ThetaSketch.from(["alice", "bob", "carol"], 0.02);
const tuesday = ThetaSketch.from(["bob", "carol", "dave"], 0.02);
const wednesday = ThetaSketch.from(["carol", "erin"], 0.02);

monday.intersect(tuesday).union(wednesday).count(); // 3
monday.union(tuesday).difference(wednesday).count(); // 3
```

Sketches of different `k` combine, and the result keeps the smaller `k`, as a
HyperLogLog union keeps the coarser precision. With the larger, unions grouped
differently would cut their samples at different points and disagree; with the
smaller, any order or grouping gives the same sketch. Both sides must share a
`seed`, or the operation throws `ParamError`.

## Read the bounds

`count()` is a point estimate. `lowerBound(sd)` and `upperBound(sd)` bracket it
at 1, 2 or 3 standard deviations, and while a sketch is exact (`isEstimating`
is false) all three are the same number.

```ts
import { ThetaSketch } from "distillate/theta";

const ids = (from: number, to: number): string[] =>
  Array.from({ length: to - from }, (_, i) => `user:${String(from + i)}`);

const both = ThetaSketch.from(ids(0, 60_000), 0.02).intersect(
  ThetaSketch.from(ids(50_000, 80_000), 0.02),
);

both.count(); // ~9888
both.lowerBound(2); // ~9164
both.upperBound(2); // ~10655
```

The true overlap is 10,000. The bounds treat the retained hashes as a binomial
sample of the true set at rate `theta`. Measured over 1,500 to 8,000 sketches
per case, the two bounds together covered the truth about 70%, 95.7% and 99.8%
of the time at 1, 2 and 3 standard deviations, against 68.3%, 95.4% and 99.7%
for a normal interval. The CI gate holds them, pooled over its counts,
intersections and differences, to at least 63%, 93% and 99%.

An intersection of disjoint sets reads 0, with an upper bound above 0: a sample
cannot rule out an overlap smaller than what it would have caught. A small
overlap between large sets is estimated from few shared hashes, so its bounds
are wide relative to it; that is the honest answer, and the bounds say so.

## Persist it

```ts
import { ThetaSketch } from "distillate/theta";

const sketch = ThetaSketch.from(["alice", "bob"], 0.02);
const restored = ThetaSketch.fromBytes(sketch.toBytes());

restored.equals(sketch); // true
restored.add("carol");
restored.count(); // 3
```

`toBytes` writes the canonical sample: the `k` smallest hashes and the next one
as `theta`. The same keys give the same bytes whatever order they arrived in,
and a restored sketch takes more keys and set operations. At the default `k`
a full frame is 32,812 bytes. `toJSON` and `fromJSON` wrap the same bytes. The
layout is [frame type 13](/reference/serialization/).

## Limits

While it takes keys, a sketch holds a table of up to `2k` hashes and a sorted
copy of up to `1.5k`, about 28 bytes per unit of `k`: 112 KiB at the default 4096. Between rebuilds the table runs ahead of the `k` hashes it reports,
which is what keeps `add` constant-time. On the wire it is at most `8k + 44`
bytes.

Hashes are 53-bit integers, below 2^53, so they compare as plain numbers.
Among 10^9 distinct keys about 55 pairs collide, a relative error near 6e-8.

The hash is seeded, not keyed, and set operations need a shared `seed`. A
sketch from an untrusted sender can claim any `k` up to 2^26: check `k` after
`fromBytes` if a large sketch would cost you.

A union keeps the smaller `k`, so combining a coarse sketch with a fine one
gives the coarse one's accuracy.
