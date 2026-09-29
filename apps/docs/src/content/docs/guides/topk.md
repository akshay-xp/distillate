---
title: Top-K
description: A heavy-hitters sketch in bounded space. It lists the keys seen most often, never underestimates one it holds, and never loses one heavier than its error.
---

`distillate/topk` ships the Frequent Items sketch: Misra and Gries' counters
(1982) with the reverse purge Apache DataSketches uses. It keeps a map of the
keys it has seen with a count for each, and when the map fills it subtracts
the median count from every key and drops the ones that reach zero.

- **A sketch that holds keys.** It answers which keys are heaviest without you
  naming them, which no other structure in the library can.
- **Never underestimates a key it holds.** A held key's count is at or above the
  truth, and anything heavier than the error is guaranteed to be held.
- **Bounded size.** Capped by the error you ask for, not by how many keys arrive.

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

## Keys come back as bytes

`top` returns each key as a `Uint8Array`, exactly as it was recorded: a string
as its UTF-8 bytes, bytes unchanged. Decode a string key with `TextDecoder`, as
in [Build one](#build-one).

```ts
import { TopK } from "distillate/topk";

const s = new TopK({ capacity: 16 });
s.add(Uint8Array.of(0xff, 0x00));

Array.from(s.top(1)[0]?.key ?? []).join(); // "255,0"
```

One type for every key, lossless whatever you fed in, and byte for byte what
the frame holds. Returning strings instead would have to guess an encoding for
keys that were never text.

## The frame holds your keys

Every other distillate frame is one-way: a Bloom filter or a Count-Min sketch
cannot give back a single key you fed it, only answer about keys you name. A
Top-K frame is different. Listing keys is the whole job, so `toBytes` stores
every key the sketch holds **verbatim**:

```ts
import { TopK } from "distillate/topk";

const s = TopK.from(
  ["alice@example.com", "alice@example.com", "bob@example.com"],
  0.01,
);

new TextDecoder().decode(s.toBytes()).includes("alice@example.com"); // true
```

Persisting a sketch persists user input. Treat a Top-K frame in a cache, a log
or a build artifact as you would the raw stream it came from. To keep raw keys
out, add a keyed digest of each key instead, and `top` will then return
digests you map back yourself.

## Untrusted keys

Heavy hitters is usually fed traffic someone else controls: client IPs, URLs,
user agents. Every key is placed in the map by a hash, and keys crafted to
share one slot would each walk the whole chain of the others on every `add`.
With a known hash that is cheap to arrange, and it made `add` over a hundred
times slower on a large map.

So the map places keys with HalfSipHash, a keyed hash built to resist exactly
this, under 64 random bits each sketch draws for itself. Without the key, no
one can tell which keys would collide. There is no option to set: no stored
byte depends on where a key sits, so the key never reaches the frame, and two
sketches fed the same stream still write the same bytes.

The key is drawn the first time the sketch hashes a key, from
`crypto.getRandomValues`. Cloudflare Workers refuse random values at module
scope, so on Workers build or decode a Top-K inside a handler. `create` alone
at module scope is fine; `add`, `from` or `fromBytes` there is not.

## Union is not the combined stream

Two sketches with the same `capacity` combine with `union`: each key's
counts add, the errors add, and the merged map is purged back to size. The
result holds the same guarantee, with an error at least the sum of the two.

It is **not** the sketch one would hold had it seen both streams, which is
where it departs from [Count-Min](/guides/countmin/):

```ts
import { TopK } from "distillate/topk";

const fed = (keys: string[]): TopK => {
  const s = new TopK({ capacity: 4 });
  for (const key of keys) s.add(key);
  return s;
};
const a = ["x", "x", "x", "y", "y", "z"];
const b = ["p", "q", "x", "r"];

const merged = fed(a).union(fed(b));
const both = fed([...a, ...b]);

merged.equals(both); // false
merged.count("x"); // 4
both.count("x"); // 4
merged.error(); // 1
both.error(); // 2
```

A single sketch purges as keys arrive, so what survives depends on their
order: here `b`'s singletons push out `a`'s lighter keys as they land. A union
purges only what each side kept. Both answers hold the guarantee, and `x`,
seen four times, reads 4 either way; they differ in which light keys survived.
Count-Min's union is exact because its counters only ever add, and addition
does not care about order.

## Space

The map is 12 bytes a slot, three `u32` arrays, plus the bytes of the keys it
holds. It starts at 8 slots and doubles as keys arrive, up to a `capacity` set
by `epsilon`, so the table is at most:

```ts
import { TopK } from "distillate/topk";

TopK.create(0.01).capacity * 12; // 6144
```

| `epsilon` | `capacity` | Table bytes, at most |
| --------- | ---------- | -------------------- |
| 0.01      | 512        | 6,144                |
| 0.001     | 4,096      | 49,152               |
| 0.0001    | 32,768     | 393,216              |

However long the stream, the table never passes that ceiling: once full, it
purges rather than grows. A sketch holding a few keys costs a few slots, and
so does decoding its frame, whatever the capacity it names.

The frame is sparse: it stores only the keys held, 8 bytes each plus the key's
length, so an empty sketch serializes small whatever its capacity:

```ts
import { TopK } from "distillate/topk";

TopK.create(0.01).toBytes().length; // 52
```

## Persist it

```ts
import { TopK } from "distillate/topk";

const s = TopK.from(["a", "a", "b"], 0.01);

const restored = TopK.fromBytes(s.toBytes());
restored.count("a"); // 2
restored.equals(s); // true
```

`toJSON` and `fromJSON` wrap the same bytes in a JSON envelope. The binary form
is [frame type 9](/reference/serialization/), readable from any language, and
two sketches holding the same keys with the same counts write the same bytes,
whatever order the keys arrived in.
