---
title: Top-K
description: A heavy-hitters sketch in fixed space. It lists the keys seen most often, never underestimates one it holds, and never loses one heavier than its error.
---

`distillate/topk` ships the Frequent Items sketch: Misra and Gries' counters
(1982) with the reverse purge Apache DataSketches uses. It keeps a map of the
keys it has seen with a count for each, and when the map fills it subtracts
the median count from every key and drops the ones that reach zero.

- **A sketch that holds keys.** It answers which keys are heaviest without you
  naming them, which no other structure in the library can.
- **Never underestimates a key it holds.** A held key's count is at or above the
  truth, and anything heavier than the error is guaranteed to be held.
- **Fixed size.** Sized by the error you ask for, not by how many keys arrive.

Misra and Gries, "Finding repeated elements", 1982. Anderson et al., "A
High-Performance Algorithm for Identifying Frequent Items in Data Streams",
2017, for the purge.

## Build one

```ts
import { TopK } from "distillate/topk";

const routes = TopK.create(0.01); // error factor

routes.add("/login", 5); // five at once
routes.add("/signup", 2);
routes.add("/about");

const decoder = new TextDecoder();
routes
  .top(2)
  .map((e) => decoder.decode(e.key))
  .join(); // "/login,/signup"
routes.count("/login"); // 5
routes.count("/never-seen"); // 0
routes.total; // 8
```

`top(k)` takes `k` on each call, so one sketch answers a top 10 and a top 100
without a rebuild. To count a stream already in hand, `from(keys, epsilon)`
records every occurrence.

## When to pick it

Pick it when the question is **which keys** appear most, and you cannot name
them in advance: the hottest routes, the noisiest clients, the most searched
terms.

| Question                            | Structure                      |
| ----------------------------------- | ------------------------------ |
| How many times did I see this key?  | [Count-Min](/guides/countmin/) |
| Which keys have I seen most?        | Top-K, this page               |
| How many distinct keys have I seen? | [HyperLogLog](/guides/hll/)    |

[Count-Min](/guides/countmin/) answers only for a key you name, because it holds
no keys at all: its counters are shared by every key that hashes to them. Top-K
holds the keys it counts, which is what lets it list them, and also why it
costs the bytes of those keys on top of its table.

## What the bound means

`epsilon` sets the most an estimate may sit above the truth, as a fraction
**of the total recorded**, not of the key's own count. `error()` reports that bound
as it stands: everything the purges have subtracted so far.

```ts
import { topKSizing } from "distillate/topk";

topKSizing(0.01); // { capacity: 512 }
```

The same number is the threshold of the guarantee. Every key whose true count
is above `error()` is held; a key at or below it may have been purged. So on a
flat stream, where no key stands out, there may be nothing to report:

```ts
import { TopK } from "distillate/topk";

const s = TopK.create(0.01);
for (let i = 0; i < 100_000; i++) s.add(`user:${i % 1000}`);

s.error(); // 259
0.01 * s.total; // 1000
```

Every key there was seen 100 times, below the error of 259, so none is
guaranteed to survive. That is the right answer: there is no heavy hitter. On a
stream with one, the key stands clear of the error:

```ts
import { TopK } from "distillate/topk";

const s = TopK.create(0.01);
for (let i = 0; i < 100_000; i++) {
  s.add(i % 10 === 0 ? "hot" : `user:${i % 2000}`);
}

s.count("hot"); // 10000
s.top(1)[0]?.lowerBound; // 9766
s.error(); // 234
```

## It never underestimates

For a key the sketch holds, `count` is never below its true count, and
`lowerBound` is never above it: the truth sits between them, and the gap is at
most `error()`. A key the sketch does not hold reads 0, since its true count
may genuinely be zero, but it cannot be heavier than `error()`.

```ts
import { TopK } from "distillate/topk";

const s = new TopK({ capacity: 4 });
for (const key of ["a", "a", "a", "a", "b", "c", "d", "e", "a"]) s.add(key);

const decoder = new TextDecoder();
s.top(2)
  .map((e) => `${decoder.decode(e.key)} ${e.count}/${e.lowerBound}`)
  .join(", "); // "a 5/4, e 2/1"
s.count("b"); // 0
s.error(); // 1
```

`a` was added five times, and its bracket is 4 to 5. `b` was added once and
purged, and one is no more than the error.

Stored counts are `u32`. An `add` or a `union` that would carry one past
`2 ** 32 - 1` throws `TopKOverflowError` and leaves the sketch untouched,
rather than wrapping to a number that would read below the truth.
