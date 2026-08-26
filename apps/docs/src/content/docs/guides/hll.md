---
title: HyperLogLog
description: Count distinct keys in space fixed by precision rather than by the answer, with exact counts while the set is small and merges that fold to the coarser precision.
---

`distillate/hll` answers a different question from every filter in the lineup:
not "have I seen this key" but "how many distinct keys have I seen".

- **Fixed space.** 12 KiB at `p = 14` counts a thousand distinct keys or a
  billion. Size is chosen before the first key arrives and never grows.
- **About 0.8% relative error** at that precision, from the analytic
  `1.04 / sqrt(2^p)`.
- **Exact while small.** Below a few thousand keys the sketch counts rather
  than estimates, so the answer is the answer.
- **Mergeable.** Two sketches combine into one covering both key sets, which is
  what makes per-shard and per-time-bucket rollups work.

It cannot tell you whether a particular key was seen. Nothing in a sketch
records membership. If that is your question, start at
[choosing a structure](/guides/choosing-a-structure/).

Flajolet, Fusy, Gandouet and Meunier (2007); Heule, Nyffeler and Flajolet
(2013) for the sparse representation.

## Count something

```ts
import { HyperLogLog } from "distillate/hll";

const sketch = HyperLogLog.create(0.01); // target relative error

sketch.add("alice");
sketch.add("bob");
sketch.add("alice"); // already seen, changes nothing

sketch.count(); // 2
```

`create` picks the smallest precision meeting the error you ask for. When the
keys are already in hand, `from` does both steps:

```ts
import { HyperLogLog } from "distillate/hll";

const sketch = HyperLogLog.from(["alice", "bob", "carol"], 0.01);
sketch.count(); // 3
```

`from` takes any iterable, and unlike the filters it never needs the key count
first: a sketch is sized by the error it targets, not by how many keys it will
see, so a stream goes straight in.

## Small counts are exact

Below its promotion threshold the sketch keeps what it has seen at a much finer
precision than its registers and counts rather than estimates. At `p = 14` that
holds to roughly three thousand distinct keys.

```ts
import { HyperLogLog } from "distillate/hll";

const sketch = new HyperLogLog({ p: 14 });
for (let i = 0; i < 100; i++) sketch.add(`user:${i}`);

sketch.count(); // exactly 100, not an estimate
```

It promotes to dense registers on its own once that stops paying, with nothing
to configure and no jump in what it reports. The saving is real: 100 keys
serialize to 426 bytes while sparse, against 12,314 once dense.

## Choose a precision

`p` is the single tuning knob, and the sketch holds `2^p` registers of six bits
each.

| `p` | Registers | Bytes  | Standard error |
| --- | --------- | ------ | -------------- |
| 10  | 1,024     | 768    | 3.25%          |
| 12  | 4,096     | 3,072  | 1.63%          |
| 14  | 16,384    | 12,288 | 0.81%          |

`p = 14` is the default `create(0.01)` lands on, and matches what Redis uses.
Reach for `hllSizing` to see the precision an error target implies without
building anything:

```ts
import { hllSizing } from "distillate/hll";

hllSizing(0.01).p; // 14
hllSizing(0.05).p; // 10
```

`standardError` reads the bound back off a sketch you already have.

## Merge sketches

`union` returns a new sketch counting the distinct keys of both, leaving each
input untouched. Overlap is handled for free, which is the whole point: adding
two counts would double-count everything the shards share.

```ts
import { HyperLogLog } from "distillate/hll";

const shardA = HyperLogLog.from(["alice", "bob"], 0.01);
const shardB = HyperLogLog.from(["bob", "carol"], 0.01);

shardA.union(shardB).count(); // 3, not 4
```

Sketches built at different precisions merge to the **coarser** of the two,
matching BigQuery and Apache DataSketches. A finer sketch folds down cleanly;
the reverse would invent detail it never recorded. Throwing instead would let
one misconfigured shard break the rollup that merging exists to serve.

Both sketches must share a seed. Merging across seeds would put the same key in
different registers and yield a count belonging to neither, so it throws
`ParamError` rather than answering quietly.

## Persist it

```ts
import { HyperLogLog } from "distillate/hll";

const sketch = HyperLogLog.from(["alice", "bob"], 0.01);

const bytes = sketch.toBytes();
const restored = HyperLogLog.fromBytes(bytes);

restored.count(); // 2
restored.equals(sketch); // true
```

Sketches are [DSTL](/reference/serialization/) type 5 and round-trip through
`toJSON`/`fromJSON` as well. The encoding travels with the frame, so a sparse
sketch comes back sparse and keeps counting exactly. Corrupt bytes are rejected
rather than parsed into a plausible wrong answer; see
[errors](/reference/errors/).

## Measured

Apple M5, node v24.14.1. Error and bytes reproduce anywhere; the timings do
not.

| Operation       | Cost           |
| --------------- | -------------- |
| `add`           | 34.89 ns/iter  |
| `count`, dense  | 19.52 us/iter  |
| `count`, sparse | 212.41 ns/iter |

`count` walks all `2^p` registers where `add` touches one, so it is the
expensive call. Count once at the end rather than in a loop.

Across a sweep of three precisions and cardinalities from 1e3 to 1e5, the mean
signed error is 0.27% and the worst single point sits at 1.54x its analytic
bound. Those numbers are gated in CI, not just published.

## Caveats

`distillate` is pre-1.0. The binary format is versioned, but the API may still
move between minor versions.

An empty sketch counts `0`, and `count` is a whole number: a cardinality is a
count of things.
