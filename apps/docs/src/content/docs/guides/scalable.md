---
title: Scalable Bloom
description: A Bloom filter for a key count you cannot know up front. It grows by opening larger, tighter stages and keeps its false-positive rate under the target however many keys arrive.
---

`distillate/scalable` ships the scalable Bloom filter of Almeida et al.
(2007): a chain of Bloom stages that opens a new, larger one each time the
newest fills. It is the answer when you cannot say how many keys are coming.

- **Mutable**, insert-only. No delete.
- **Grows without a ceiling you set**, and holds `epsilon` for the whole chain.
- **Mergeable** with `union` at identical settings.

Almeida, Baquero, Preguiça and Hutchison, "Scalable Bloom Filters", 2007.

## Build one

```ts
import { ScalableBloomFilter } from "distillate/scalable";

const seen = ScalableBloomFilter.create(1000, 0.01); // first stage, target FPR

seen.add("alice");
seen.has("alice"); // true
seen.has("bob"); // false
```

`create(n, epsilon)` sizes the first stage for `n` keys. Past that, the filter
opens a second stage twice the size, then a third, and so on:

```ts
import { ScalableBloomFilter } from "distillate/scalable";

const seen = ScalableBloomFilter.create(10, 0.01);
for (let i = 0; i < 30; i++) seen.add(`key-${String(i)}`);

seen.stages; // 2
seen.capacity; // 30
```

To build from a key set you already hold, `from(keys, epsilon)` sizes the
first stage to their count and keeps growing after that.

## When to pick it

Pick it over `BloomFilter` when you cannot give a good `n`: a stream, a
crawler's seen-URL set, a dedup set that keeps growing. A `BloomFilter` past
its `n` keeps accepting keys and silently exceeds its false-positive rate;
this filter opens another stage instead.

It costs space to stay honest. Each stage aims below `epsilon` so the chain
as a whole stays under it, so at the same target the first stage is larger
than a `BloomFilter` sized for the same `n`:

```ts
import { BloomFilter } from "distillate/bloom";
import { ScalableBloomFilter } from "distillate/scalable";

BloomFilter.create(1000, 0.01).bitsPerKey; // ~9.59
ScalableBloomFilter.create(1000, 0.01).bitsPerKey; // ~13.53
```

A lookup also checks every stage, so it slows a little with each one that
opens. If you do know `n`, a `BloomFilter` sized for it is smaller and faster.

## Growth and tightening

Two settings shape the chain, both optional:

- `growth` (default `2`): each stage holds `growth` times the keys of the one
  before. Larger means fewer stages, so faster lookups, at the cost of a bigger
  jump in memory each time one opens.
- `tightening` (default `0.85`): each stage's false-positive target is
  `tightening` times the one before. Lower spends more bits on the early stages
  and less on the late ones. `0.85` sits in the 0.8 to 0.9 range the paper
  recommends.

```ts
import { ScalableBloomFilter } from "distillate/scalable";

const seen = ScalableBloomFilter.create(1000, 0.01, {
  growth: 4,
  tightening: 0.5,
});
seen.bitsPerKey; // ~11.03
```

## The false-positive bound

Stage `i` holds `n * growth ** i` keys at a target of
`epsilon * (1 - tightening) * tightening ** i`. Those targets form a geometric
series that sums to at most `epsilon`, so the chain stays under `epsilon`
however many stages open.

Measured with `n = 1000` and `epsilon = 0.01`, after 100,000 keys (a hundred
times the first stage): 0.63% with the defaults across 7 stages, and 0.98% with
`growth: 4, tightening: 0.5` across 5. `rate()` estimates the current rate from
how full each stage actually is.

## Re-adding a key

A key the filter already holds is not counted again, so duplicates never use
up a stage's capacity. A stream heavy with repeats does not open stages its
distinct keys do not need:

```ts
import { ScalableBloomFilter } from "distillate/scalable";

const seen = ScalableBloomFilter.create(100, 0.01);
seen.add("alice");
seen.add("alice");
seen.add("alice");
seen.count; // 1
```

The same check applies to a new key that happens to look present already, a
false positive: it is not counted either, because the filter already answers
yes for it.

## The size ceiling

A stage cannot exceed `2^32 - 1` bits. When the next stage would, `add` throws
a `RangeError` instead of opening it, and the filter is left as it was: it
still answers every query, it just cannot take new keys.

```ts
import { ScalableBloomFilter } from "distillate/scalable";

const seen = ScalableBloomFilter.create(1, 0.5, { growth: 1e10 });
seen.add("a");

let error: unknown;
try {
  seen.add("b");
} catch (e) {
  error = e;
}
error instanceof RangeError; // true
seen.has("a"); // true
```

With the defaults the ceiling is far off: the chain holds hundreds of millions
of keys first.

## Merge two filters

`union` merges two filters built with the same settings, stage by stage. It
throws `ScalableParamMismatchError` if any setting differs.

```ts
import { ScalableBloomFilter } from "distillate/scalable";

const a = ScalableBloomFilter.create(10, 0.01);
const b = ScalableBloomFilter.create(10, 0.01);
a.add("alice");
b.add("bob");

const both = a.union(b);
both.has("alice"); // true
both.has("bob"); // true
```

## Persist it

`toBytes` and `fromBytes` round-trip through the portable binary format, and
`toJSON` and `fromJSON` wrap the same frame in JSON.

```ts
import { ScalableBloomFilter } from "distillate/scalable";

const seen = ScalableBloomFilter.create(10, 0.01);
for (let i = 0; i < 30; i++) seen.add(`key-${String(i)}`);

const restored = ScalableBloomFilter.fromBytes(seen.toBytes());
restored.equals(seen); // true
restored.stages; // 2
```

Which stage a key lands in depends on when it arrived, so two filters given
the same keys in a different order can be unequal. The frame layout is in the
[serialization reference](/reference/serialization/).
