---
title: DDSketch
description: A quantile sketch whose every answer, p99.9 included, is within a relative error of the true value. Mergeable exactly, bounded in memory, and readable by Datadog.
---

`distillate/ddsketch` ships DDSketch (Masson, Rim and Lee, VLDB 2019), the
quantile sketch Datadog runs in production. It answers "what is the p50, p99 or
p99.9 of these values?" for latencies, payload sizes, queue depths: anything
numeric.

- **A guarantee on the value, not the rank.** Every quantile it reports is
  within `relativeAccuracy` of the true value at that quantile, tails included.
- **Exact merges.** Two sketches combine into exactly the sketch one stream
  would have built, so per-host or per-shard sketches roll up without error.
- **Bounded memory.** By default it keeps at most 4096 bins per sign, enough for
  about 19 orders of magnitude at 1%.

## Build one

```ts
import { DDSketch } from "distillate/ddsketch";

const latency = DDSketch.create(0.01); // within 1% of the truth
for (let ms = 1; ms <= 1000; ms++) latency.add(ms);

latency.count; // 1000
latency.quantile(0.5); // ~504
latency.quantile(0.99); // ~992
latency.quantiles([0.5, 0.9, 0.99]); // three at once
latency.min; // 1
latency.max; // 1000
```

The true median of 1 to 1000 at rank `floor(0.5 * 999)` is 500, and 504 is
within 1% of it; the true p99 is 990, and 992 is within 1% of that.
`quantile(0)` and `quantile(1)` return `min` and `max` exactly, and `count`,
`sum`, `min` and `max` are kept exactly beside the bins. `add(value, count)`
records a value `count` times in one call, for data that arrives already
aggregated. Negative values and zero are recorded like any other.

## When to pick it

Pick DDSketch when you need percentiles of a stream you cannot keep: keeping
every value and sorting is exact but grows without bound.

The usual alternative is t-digest. It is widely deployed and accurate in
practice, but its error has no proven bound, so there is no figure to promise or
to test against. DDSketch's bound holds by construction and is gated in this
library's CI. Its guarantee is also the right one for latencies: an error
relative to the value stays meaningful at p99.9, where an error in rank, as KLL
gives, does not.

DDSketch answers questions about values. For counting distinct keys, or how
often a key appears, see [choosing a structure](/guides/choosing-a-structure/).

## What relative accuracy means

`relativeAccuracy` is a bound on the value: if the true p99 is 200 ms, a sketch
built at 0.01 reports something in `[198, 202]`. The bound is the same at every
quantile, which is what makes it suit tails: a latency distribution's p99.9 can
be a hundred times its median, and an error relative to each stays in
proportion.

It works by binning values on a logarithmic scale. Bin `i` covers values from
`gamma^i` up to `gamma^(i+1)`, where `gamma = (1 + a) / (1 - a)` for accuracy `a`,
and reads back as a value within `a` of everything in it. Space therefore grows
with the range of values, not their number: a million values between 1 ms and
10 s take the same bins as a thousand.

The rank the guarantee is stated at is `floor(q * (count - 1))`, the value that
many places from the smallest.

## Choosing a mapping

The mapping turns a value into a bin index. All five meet the same bound; they
differ in how fast they find a bin and how many bins that takes.

| Mapping            | How it finds the bin                              | Adds, relative         | Bins, relative to log |
| ------------------ | ------------------------------------------------- | ---------------------- | --------------------- |
| `bitwiseMapping`   | the float's exponent and top bits, as one integer | about 2x (the default) | about 1.85x           |
| `logMapping`       | `Math.log2`                                       | 1x                     | 1x                    |
| `linearMapping`    | linear interpolation of the bits                  | about 1.1x             | about 1.44x           |
| `quadraticMapping` | a quadratic in the float's bits                   | about 0.95x            | about 1.08x           |
| `cubicMapping`     | a cubic in the float's bits                       | about 0.9x             | about 1.01x           |

```ts
import { DDSketch, logMapping } from "distillate/ddsketch";

const compact = DDSketch.create(0.01, { mapping: logMapping });
compact.mapping.kind; // "log"
```

The default, `bitwiseMapping`, is the one sketches-java's `DDSketch.fast()`
uses: finding a bin takes no logarithm and no floating-point arithmetic at all,
which is what makes it about twice as fast as the log mapping in the
[benchmark results](/bench/results/). Its bins come in powers of two, so it
takes the finest that meets the accuracy you ask for: at 0.01 it delivers
0.78%. Choose `logMapping` when memory or serialized size matters more than
`add`: it needs the fewest bins for the bound.

The interpolated mappings were designed to avoid a logarithm per value, but
`Math.log` is cheap in V8, so they are here so a sketch built with one of them
by Datadog's libraries can be read and merged, bin for bin. The bitwise mapping
travels as a linear one, so Datadog's decoders read it too.

## Choosing a store

The store holds the bins, one per sign. Bins are spent only where values land,
so the store decides what happens when the range of values grows.

- `collapsingLowestStore(maxBins)`, the default at 4096: past `maxBins` bins it
  folds the smallest magnitudes into one bin, so values nearest zero lose
  accuracy while both tails keep it.
- `collapsingHighestStore(maxBins)`: the mirror, giving up the largest
  magnitudes, for data where the small end matters.
- `denseStore()`: unbounded, for a range you know is narrow.
- `sparseStore()`: unbounded, and pays only for the bins used, for a few values
  far apart.

Mappings and stores come from these factories only. A sketch serializes them by
kind, so a custom implementation would be read back as the built-in one of the
same kind.

`maxBins` is sized for the default accuracy of 1%, where 4096 of the default
mapping's bins span about 19 orders of magnitude. A tighter accuracy needs
proportionally more bins for the same range: at `0.001`, a typical latency
distribution needs around 6,600, so the default store collapses its low end. Raise the bound when you tighten the
accuracy:

```ts
import { collapsingLowestStore, DDSketch } from "distillate/ddsketch";

const fine = DDSketch.create(0.001, { store: collapsingLowestStore(8192) });
fine.store.maxBins; // 8192
```

Accuracy also bounds the range a mapping can index at all, since bins that fine
run out of float precision. At `1e-9` the default mapping indexes magnitudes
from 0.125 to 8 and `logMapping` from about 0.037 to 27; smaller magnitudes
count as zero and larger ones are rejected. Tight enough, and no value is indexable: `create` then throws a
`ParamError` rather than build a sketch that would count everything as zero.

## Union

`union` returns a new sketch holding both streams, leaving both operands as they
were. The bins are exactly those one sketch fed both streams would hold, through
a collapsing store too; `sum` matches up to float rounding.

```ts
import { DDSketch, DDSketchParamMismatchError } from "distillate/ddsketch";

const morning = DDSketch.from([1, 2, 3], 0.01);
const evening = DDSketch.from([4, 5], 0.01);
morning.union(evening).count; // 5

try {
  morning.union(DDSketch.from([1], 0.02)); // bins of a different width
} catch (error) {
  error instanceof DDSketchParamMismatchError; // true
}
```

Sketches must share a mapping: the same kind, and the same `gamma` and offset to
within 1e-12. The store may differ, and the union takes the receiver's.

## Persist it

```ts
import { DDSketch } from "distillate/ddsketch";

const sketch = DDSketch.from([3.7, 12.25, -0.41, 0, 1500.3], 0.01);
const bytes = sketch.toBytes();
DDSketch.fromBytes(bytes).equals(sketch); // true
```

`toBytes` writes a DSTL frame, type 10, holding the mapping, the store, the
summaries and every non-empty bin, readable from other languages: see the
[serialization reference](/reference/serialization/). The bytes depend only on
the bins and summaries, not on the order values arrived. `toJSON` and
`fromJSON` wrap the same bytes for JSON transports.

## Send it to Datadog

Datadog's agent and libraries exchange DDSketches as a protobuf message, and
`distillate/ddsketch/protobuf` reads and writes it with no dependencies. It is
its own subpath, so a bundle that never talks to Datadog never carries it.

```ts
import { DDSketch } from "distillate/ddsketch";
import { fromProtobuf, toProtobuf } from "distillate/ddsketch/protobuf";

const sketch = DDSketch.create(0.01);
for (let ms = 1; ms <= 1000; ms++) sketch.add(ms);

const message = toProtobuf(sketch); // Uint8Array, as sketches-go writes it
const back = fromProtobuf(message);
back.quantile(0.99); // ~992
back.min; // ~1.01
back.sum; // ~502237
```

The message carries the mapping and the bins but no sum, min or max. On decode they
are derived from the bins, so they come back within the accuracy rather than
exactly: `min` is 1.01 here, not 1. Quantiles are unaffected. Sending the bytes
to Datadog, with its endpoint and authentication, is up to you.

`fromProtobuf` decodes into `collapsingLowestStore(4096)`, where sketches-go
takes a dense store. A message of a few dozen bytes can name two bins billions
of indices apart, and a dense store would allocate every slot between them. For
trusted input, pass `{ store: denseStore() }` to match sketches-go. A DSTL frame
keeps the store it was written with, so a frame from an untrusted source that
declares a dense store can be just as large; decode those only from senders you
trust.
