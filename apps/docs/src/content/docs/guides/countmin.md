---
title: Count-Min
description: A frequency sketch in fixed space. It answers how many times a key appeared, never below the truth, at most a chosen fraction of the total above it.
---

`distillate/countmin` ships the Count-Min sketch of Cormode and Muthukrishnan
(2005): a grid of counters, `depth` rows of `width` each, where a key increments
one counter per row and its estimate is the smallest of them.

- **A sketch, not a filter.** It cannot say whether it saw a key, only how often.
- **Never underestimates.** The answer is at or above the truth, never below.
- **Fixed size.** Sized by the error you ask for, not by how many keys arrive.

Cormode and Muthukrishnan, "An Improved Data Stream Summary: The Count-Min
Sketch and its Applications", 2005.

## Build one

```ts
import { CountMinSketch } from "distillate/countmin";

const hits = CountMinSketch.create(0.001, 0.001); // error factor, failure probability

hits.add("/login");
hits.add("/login", 4); // four at once
hits.add("/signup");

hits.count("/login"); // 5
hits.count("/never-seen"); // 0
hits.total; // 6
```

`create(epsilon, delta)` sizes the grid. To count a stream already in hand,
`from(keys, epsilon, delta)` records every occurrence.

## When to pick it

Pick it when the question is **how many times**, not whether or how many
distinct. Hot keys in a cache, requests per route, events per user, the tail of
a stream too big to hold.

The three questions the library answers are different structures:

| Question                        | Structure                                     |
| ------------------------------- | --------------------------------------------- |
| Have I seen this key?           | a filter, see [Classic Bloom](/guides/bloom/) |
| How many distinct keys?         | [HyperLogLog](/guides/hll/)                   |
| How many times did I see a key? | Count-Min, this page                          |

A filter cannot count, and HyperLogLog counts distinct keys without recording
any of them. Count-Min is the one that attributes a number to a key.

It holds no keys, so it cannot list the most frequent ones: it answers only for
a key you name. Finding the top keys without naming them needs a heavy-hitters
structure, which is not shipped yet.

## What the bound means

Two knobs, and they do different jobs.

`epsilon` sets how far above the truth an answer may sit, as a fraction
**of the total recorded**, not of the key's own count. `delta` is the
probability that bound is exceeded.

```ts
import { CountMinSketch, countMinSizing } from "distillate/countmin";

countMinSizing(0.001, 0.001); // { width: 2719, depth: 7 }

const s = CountMinSketch.create(0.001, 0.001);
s.add("a", 1000);

s.error(); // the bound right now, epsilon * total
```

So the error is absolute, not relative, and it grows with everything the sketch
has recorded. After a million events at `epsilon` of 0.001, an estimate may sit
up to 1000 above the truth. That is noise for a key seen 80,000 times and
useless for one seen 3 times. Count-Min is a tool for heavy keys; the light tail
is where the error lives.

`width` comes from `epsilon` and `depth` from `delta`. Extra rows do not tighten
the bound, they lower the chance of missing it.

## It never underestimates

Every answer is at or above the true count, never below it. A key's counters
are shared with other keys, so a collision only ever pushes an estimate up.

That one-sided guarantee is why the API refuses anything that would break it. A
negative count is rejected with `ParamError`, since a decrement could pull an
estimate below the truth, and a counter that would overflow throws rather than
wrapping.

## Repeats are the point

```ts
import { CountMinSketch } from "distillate/countmin";

CountMinSketch.from(["bob", "bob"], 0.01, 0.01).count("bob"); // 2
```

`from` counts every occurrence. This is the **opposite** of
[`CuckooFilter.from`](/guides/cuckoo/), which ignores repeats because each one
would cost a slot in a table sized for distinct keys. Both are right for their
structure: a repeat is waste to a filter and data to a frequency sketch.

## When a counter overflows

A counter holds a `u32`. An `add` or a `union` that would carry one past
`2 ** 32 - 1` throws `CountMinOverflowError` and leaves the sketch untouched.

```ts
import { CountMinSketch, CountMinOverflowError } from "distillate/countmin";

const s = new CountMinSketch({ width: 8, depth: 2 });
s.add("a", 0xffffffff);

try {
  s.add("a");
} catch (err) {
  err instanceof CountMinOverflowError; // true
}

s.count("a"); // 4294967295
```

Saturating would be quieter and wrong: a counter pinned at its maximum reads as
an underestimate from then on, silently, which is the one thing the structure
promises cannot happen.

## Space

The grid is `width * depth` counters of four bytes, fixed by `epsilon` and
`delta` before a single key arrives. It does **not** grow with the stream.

```ts
import { CountMinSketch } from "distillate/countmin";

const s = CountMinSketch.create(0.001, 0.001);

s.width * s.depth * 4; // 76132
```

That 74 KiB counts a thousand events or a billion. Halving `epsilon` doubles the
width; each step down in `delta` adds one row, so accuracy is cheap in rows and
expensive in columns.

| `epsilon` | `delta` | Grid        | Bytes     |
| --------- | ------- | ----------- | --------- |
| 0.01      | 0.01    | 272 x 5     | 5,440     |
| 0.001     | 0.001   | 2,719 x 7   | 76,132    |
| 0.0001    | 0.0001  | 27,183 x 10 | 1,087,320 |

## Persist it

```ts
import { CountMinSketch } from "distillate/countmin";

const s = CountMinSketch.from(["a", "a", "b"], 0.01, 0.01);

const restored = CountMinSketch.fromBytes(s.toBytes());
restored.count("a"); // 2
restored.equals(s); // true
```

`toJSON` and `fromJSON` wrap the same bytes in a JSON envelope. The binary form
is [frame type 8](/reference/serialization/), readable from any language.

Two sketches with the same geometry and seed combine with `union`, and the
result is exactly the sketch one would hold had it seen both streams:

```ts
import { CountMinSketch } from "distillate/countmin";

const a = CountMinSketch.from(["x", "y"], 0.01, 0.01);
const b = CountMinSketch.from(["x"], 0.01, 0.01);

a.union(b).count("x"); // 2
```

Unlike the filters, this is not idempotent: `a.union(a)` doubles every count,
because counts add where bits only ever turn on.
