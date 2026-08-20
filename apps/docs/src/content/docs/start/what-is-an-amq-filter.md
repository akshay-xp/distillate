---
title: What is an AMQ filter?
description: Approximate membership query filters answer "have I seen this key?" in a fraction of the space of the set itself, with a tunable false positive rate and no false negatives.
---

An approximate membership query (AMQ) filter answers one question: **is this
key in the set?** It answers in a fraction of the space storing the set would
take, and it trades exactness for that space in one direction only.

## The one-sided error

A filter has two possible answers, and only one of them can be wrong.

- **"no" is always true.** If the filter says a key is absent, it is absent.
  There are no false negatives, ever.
- **"yes" is usually true.** A small fraction of absent keys come back as
  present anyway. That fraction is the false positive rate (FPR), written
  `epsilon`, and you choose it when you size the filter.

That asymmetry is what makes a filter useful. Put one in front of an expensive
lookup and every "no" skips the lookup with certainty. Only the false
positives cost a wasted trip, and you decide up front how often that happens.

## What it costs

A filter stores no keys. It stores a bit pattern derived from them, so its
size depends on the number of keys and the target FPR, never on how long the
keys are. The information-theoretic floor is `log2(1/epsilon)` bits per key:
6.64 bits/key at a 1% FPR, 9.97 at 0.1%. Real structures land a little above
that floor, and how close they get is most of what separates them.

Storing a million 40-byte keys in a `Set` costs tens of megabytes. A filter
over the same keys at a 1% FPR costs roughly 1.2 MB, whatever the keys are.

## What you give up

- **No enumeration.** You cannot list the members back. The keys are not in
  there.
- **No lookup.** Membership only. A filter maps to a bit, not to a value.
- **Deletion is structural.** Classic and blocked Bloom filters cannot remove
  a key. Structures that can are a design choice made at build time, not an
  option you turn on later.
- **Capacity is planned.** You size for `n` keys. Overshoot `n` and the real
  FPR drifts above your target.

## Where it pays off

- Skipping a disk read, an index seek, or a network call for keys that are not
  there. This is why storage engines put a filter in front of every table.
- Deduplicating a stream when a rare duplicate slipping through is cheaper
  than holding every key seen.
- Shipping a membership set to a client, an edge worker, or another service
  where the full set would not fit in the budget.

It does not pay off when a false "yes" is unsafe, when the set is small enough
to hold exactly, or when you need anything back besides yes or no.

## What distillate adds

There is no single best filter, only a best filter per workload. A static set
built once wants a different structure than streaming inserts do. distillate
ships one narrow interface across all of them, so picking correctly is a
change of import rather than a rewrite:

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(100_000, 0.01); // capacity, target FPR
filter.add("alice");

filter.has("alice"); // true, always
filter.has("bob"); // false, or a ~1% false positive
```

Each structure ships on its own subpath so you bundle only what you import,
with zero runtime dependencies and no `eval`, and every structure serializes
to the same portable binary format.

## Next

- [Install](/start/install/) and run the quick start.
- [Choosing a structure](/guides/choosing-a-structure/) maps workloads onto
  the lineup.
