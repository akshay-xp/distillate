---
title: KLL
description: A quantile sketch whose error is bounded in rank, so "what share of values are at or below x?" has a guaranteed answer, in memory fixed by k alone.
---

`distillate/kll` ships the KLL sketch (Karnin, Lang and Liberty), which answers
"what share of values are at or below x?" and "what value sits at rank q?" for
a stream of numbers you cannot keep.

- **Exact while small.** Below `k` values, 200 by default, every answer is
  exact.
- **Bounded in rank past that.** Every rank and quantile is within about
  `±1.33%` of the stream's positions at the default `k`, whatever the
  distribution of values.
- **Fixed memory.** Its size depends on `k` alone, not on the range of values
  or the length of the stream.

## Rank and quantile

```ts
import { KllSketch } from "distillate/kll";

const latency = new KllSketch({ seed: 1 }); // k 200
for (let i = 0; i < 100_000; i++) latency.add((i * 7919) % 1000);

latency.rank(200); // ~0.205: the share at or under 200 ms (truth 0.201)
latency.quantile(0.5); // ~497 (truth 499)
latency.quantile(0.99); // ~990 (truth 989)
latency.cdf([100, 250, 500]); // ~[0.102, 0.255, 0.503, 1]
latency.pmf([100, 250, 500]); // ~[0.102, 0.152, 0.248, 0.497]
```

The stream is 100,000 latencies spread evenly over 0 to 999 ms.

- `rank(x)` is the share of the stream at or below `x`.
- `quantile(q)` is the value at rank `floor(q * (count - 1))`, with
  `quantile(0)` and `quantile(1)` exactly `min` and `max`. `quantiles(qs)`
  answers several at once.
- `cdf(splits)` gives the share at or below each split, then 1. `pmf(splits)`
  gives the share in each interval between them. Splits must be strictly
  increasing.
- `add(value, count)` records a value `count` times in `O(log count)`.

An empty sketch answers `NaN`. `KllSketch.create(rankError)` sizes a sketch to a
target error, and `count`, `min`, `max`, `isEmpty` and `retained` read its state.

## When to pick it

Pick KLL when the question is about ranks: how many requests met a 200 ms SLO,
which bucket a value falls in, the whole distribution as a CDF. Its error is a
share of the stream, so it is the same at every value, on any distribution, and
needs no idea of the range in advance.

Pick [DDSketch](/guides/ddsketch/) when the question is the value at an extreme
quantile, such as the p99.9 latency. Its error is relative to the value, which
stays tight in the tails, where a rank error of 1% can be the whole tail.
[Choosing a structure](/guides/choosing-a-structure/#kll-or-ddsketch) compares
the two.

## Read the error

`normalizedRankError()` is the error of a single rank or quantile at 99%
confidence, as a share of `count`: about 1.33% at the default `k` of 200.
`normalizedRankError(true)` is the error over every point of a CDF or PMF at
once, about 1.65% at `k` 200. Both are the fits Apache DataSketches publishes
for this algorithm: `2.296 / k^0.9723` and `2.446 / k^0.9433`.

`kllSizing(rankError)` gives the smallest `k` that meets a single-rank error,
without building anything: `kllSizing(0.005).k` is 547.

This library's CI holds the sketch to those bounds. Over 100 seeds per cell, at
`k` 200, on uniform, ascending, descending, duplicate-heavy and alternating
streams, and through merge trees of 16 shards:

- no trial went over the published bounds, pooled over 4,800 single ranks and
  1,600 CDFs;
- the worst single-rank error came to 0.68 of `normalizedRankError()`;
- in every cell, the 99th percentile of the worst CDF error came to at most
  0.55 of `normalizedRankError(true)`.

## Union

`a.union(b)` returns a new sketch that answers as one sketch fed both streams
would, within the bound, and leaves both inputs untouched. It takes the
smaller `k` of the two, so a coarse sketch merged with a fine one has the
coarse one's accuracy. The bound holds through any tree of merges, so shards
can be merged in whatever order they arrive.

```ts
import { KllSketch } from "distillate/kll";

const monday = new KllSketch({ seed: 1 });
const tuesday = new KllSketch({ k: 400, seed: 2 });
for (let i = 0; i < 50_000; i++) {
  monday.add(i);
  tuesday.add(50_000 + i);
}

const week = monday.union(tuesday);
week.k; // 200
week.rank(25_000); // ~0.252
```

## Seeds

A compaction keeps half of a level's items from a random offset, drawn from a
small generator the sketch holds. With no `seed`, each sketch draws its own at
its first compaction. The merge bound assumes the shards' coins are
independent, so a fixed default would correlate their errors.

Pass `new KllSketch({ seed })` when runs must repeat: the same stream with the
same seed gives byte-identical frames. Give each shard its own seed.

The seed is drawn lazily rather than in the constructor, because
Cloudflare Workers refuse random values at module scope, where a sketch is
often created.

## Persist it

`toBytes()` writes the sketch as a [frame](/reference/serialization/) of type
14, and `KllSketch.fromBytes(bytes)` reads it back. `toJSON()` and
`KllSketch.fromJSON` wrap the same bytes for JSON, and `equals` compares two
sketches byte for byte.

The frame carries the generator state, so a decoded sketch flips the same
coins the original would have: fed the same values, the two write the same
bytes.

## Limits

- **Numbers only.** Values are stored as doubles. Any number but `NaN` is
  accepted, `±Infinity` and `-0` included; `NaN` throws `ParamError`.
- **Weak in the tails.** A rank error of 1.33% is 1,330 positions in 100,000:
  at p99.9 the answer can be anywhere in the top 1.4%. Use DDSketch there.
- **Memory.** Over `L` levels the sketch holds at most `3k + 8L` items, as
  doubles. At the default `k`, ten million values sit in 16 levels and 638
  items, a 5,228-byte frame; `2^53` values, the most a count can hold, need 54
  levels and at most 948 items, about 7.4 KiB.
- **`k` from 8 to 65535.** Error falls roughly as `1 / k`.
