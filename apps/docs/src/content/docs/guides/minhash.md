---
title: MinHash
description: A similarity sketch that estimates how much two sets overlap from fixed-size signatures, with an LSH index that finds near-duplicates without comparing every pair.
---

`distillate/minhash` ships MinHash, which answers "how similar are these two
sets?" as the Jaccard similarity `|A ∩ B| / |A ∪ B|`, and `MinHashLSH`, an index
that finds the stored sets likely to be similar to a query without comparing
against every one. Shingle documents, records or chunks into sets, and the pair
finds near-duplicates.

- **Fixed size.** A sketch is `k` slots, 128 by default, whether the set holds
  ten items or ten million.
- **One hash per item.** Each item touches one slot (one-permutation hashing),
  where classic MinHash computes `k` hashes per item.
- **Exact merges.** Two sketches of the same `k` and seed combine into exactly
  the sketch of the union of their sets.

## Build one

```ts
import { MinHash } from "distillate/minhash";

const early = Array.from({ length: 1000 }, (_, i) => `user:${String(i)}`);
const late = Array.from({ length: 1000 }, (_, i) => `user:${String(i + 500)}`);

const a = MinHash.from(early, 0.05); // standard error at most 0.05
const b = MinHash.from(late, 0.05);

a.k; // 100
a.jaccard(b); // ~0.38
```

The two sets share 500 of 1,500 users, so the true similarity is 1/3, and 0.38
is within one `standardError` of it. `MinHash.create(maxError)` sizes an empty
sketch the same way, `new MinHash({ k, seed })` takes the slot count directly,
and `add(item)` records one item: a string, `Uint8Array` or `ArrayBuffer`.

## When to pick it

Pick MinHash when the question is about two sets at once: how much they
overlap, or which stored sets resemble this one. Shingle text into word or
character n-grams and it finds near-duplicate documents; feed it the items
behind two keys and it compares audiences, baskets or dependency trees.

It is not [HyperLogLog](/guides/hll/), which counts how many distinct items one
set holds and cannot compare two. Neither reports whether a particular item is
present; that is a filter's job. See
[choosing a structure](/guides/choosing-a-structure/).

## What the estimate means

`jaccard` is the fraction of slots two sketches agree on. Its standard error is
at most `0.5 / sqrt(k)`, reached at a similarity of 0.5 and smaller towards 0
and 1; `standardError` reports it. `minHashSizing(maxError)` gives the smallest
`k` that meets a target, up to 4096 slots (a standard error of about 0.008).

A set smaller than `k` leaves slots empty. Those are filled from the slots that
were hit, a step called densification, so two small sets still compare
correctly and the estimate stays unbiased. But a 20-item set fills at most 20
of 128 slots, and its error runs about 1.3 times the bound: measured at 0.056
against 0.044 at a similarity of 0.5. From about `k` items up the bound holds.

Two empty sketches have similarity 1; an empty sketch against a non-empty one
has similarity 0. Comparing sketches of different `k` or seed throws
`ParamError`, since their slots mean different things.

## Union

```ts
import { MinHash } from "distillate/minhash";

const monday = MinHash.from(["alice", "bob"], 0.05);
const tuesday = MinHash.from(["bob", "carol"], 0.05);
const week = MinHash.from(["alice", "bob", "carol"], 0.05);

monday.union(tuesday).equals(week); // true
```

`union` keeps the smaller value in every slot, which is exactly the sketch one
stream of both sets would have built. Neither input changes.

## Persist it

```ts
import { MinHash } from "distillate/minhash";

const sketch = MinHash.from(["alice", "bob"], 0.05);
const bytes = sketch.toBytes();

bytes.length; // 428
MinHash.fromBytes(bytes).equals(sketch); // true
```

The frame stores the raw slots, `k` and the seed: 4 bytes a slot plus 28 of
header and params. Slots are stored before densification, so a decoded sketch
still merges exactly. `toJSON` and `fromJSON` wrap the same bytes for JSON. The
layout is in the [serialization reference](/reference/serialization/).

## Find near-duplicates

```ts
import { MinHash, MinHashLSH } from "distillate/minhash";

// Three-word shingles: each document becomes the set of its word triples.
const shingles = (text: string): string[] => {
  const words = text.toLowerCase().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i + 3 <= words.length; i++) {
    out.push(words.slice(i, i + 3).join(" "));
  }
  return out;
};

const sketch = (text: string): MinHash => MinHash.from(shingles(text), 0.05);

const lsh = new MinHashLSH<string>({ threshold: 0.5, k: 100 });
lsh.insert(
  "fox",
  sketch(
    "the quick brown fox jumps over the lazy dog while the cat sleeps on the warm mat by the door",
  ),
);
lsh.insert(
  "data",
  sketch(
    "an entirely different sentence about probabilistic data structures and their space",
  ),
);

lsh.bands; // 20
lsh.rows; // 5
const found = lsh.query(
  sketch(
    "the quick brown fox jumps over the lazy dog while the cat naps on the warm mat by the door",
  ),
);
found.length; // 1
found[0]; // "fox"
```

The index cuts each signature into `bands` of `rows` slots and files a key
under every band. A query returns every stored key that matches it in at least
one band. `lshSizing(threshold, k, weights?)` picks the split, minimising the
weighted chance of a false positive below the threshold and a false negative
above it, and reports both; the index uses it, and `weights` trades one for the
other.

The cut is a curve, not a step. With the balanced default, a pair just above
the threshold is a candidate most of the time, not always: at a threshold of
0.5 and `k` 128, a pair at 0.6 is found about 87% of the time and one at 0.7
about 99%. Candidates are likely matches, not confirmed ones, so check each
with `jaccard` where it matters. `remove(key)` takes a key back out. The index
lives in memory; persist the sketches and insert them again to rebuild it.

## Limits

The hash is seeded, not keyed: anyone who knows the seed can craft items that
land in chosen slots. Fed crafted items, an index can be made to file many keys
under the same bands, so queries return floods of candidates. Choose a private
`seed` when the items come from people who may want that, and cap how many
candidates you act on.

MinHash estimates resemblance, not containment: a short document fully quoted
inside a long one has low Jaccard similarity to it.
